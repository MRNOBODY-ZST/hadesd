package sh.hades.daemon.community;

import java.time.Instant;
import java.util.*;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.*;
import reactor.core.scheduler.Schedulers;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.media.StoragePort;
import sh.hades.daemon.release.ReleaseService;
import sh.hades.daemon.shared.Api;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;

@Service
public class UserFileService {
  private final DatabaseClient db;
  private final StoragePort storage;
  private final TransactionalOperator tx;
  private final AuditService audit;
  private final ReleaseService releases;
  public UserFileService(DatabaseClient db, StoragePort storage, TransactionalOperator tx, AuditService audit, ReleaseService releases) {
    this.db=db; this.storage=storage; this.tx=tx; this.audit=audit; this.releases=releases;
  }

  static Media map(io.r2dbc.spi.Row r) {
    return new Media(r.get("id", String.class), r.get("filename", String.class), r.get("mime", String.class), r.get("byte_size", Long.class), r.get("created_at", String.class));
  }

  public Mono<Void> lockOwner(String owner) {
    return db.sql("SELECT id FROM blog_account WHERE id=:owner FOR UPDATE").bind("owner", owner)
        .map((r,m)->r.get("id",String.class)).one()
        .switchIfEmpty(Mono.error(Problem.missing("账号不存在"))).then();
  }

  public Mono<Media> owned(String owner, String id) {
    return db.sql("SELECT * FROM user_file WHERE id=:id AND owner_id=:owner").bind("id", id).bind("owner",owner)
        .map((r,m)->map(r)).one().switchIfEmpty(Mono.error(Problem.missing("附件不存在")));
  }

  public Mono<Page<Media>> list(String owner, int page, int size) {
    Api.bounds(page,size);
    return Mono.zip(db.sql("SELECT * FROM user_file WHERE owner_id=:owner ORDER BY created_at DESC,id LIMIT :size OFFSET :offset")
        .bind("owner",owner).bind("size",size).bind("offset",(long)page*size).map((r,m)->map(r)).all().collectList(),
        db.sql("SELECT COUNT(*) n FROM user_file WHERE owner_id=:owner").bind("owner",owner).map((r,m)->r.get("n",Long.class)).one())
        .map(t->new Page<>(t.getT1(),page,size,t.getT2()));
  }

  private record Inspected(String mime, String hash) {}

  public Mono<Media> upload(String owner, FilePart file) {
    return DataBufferUtils.join(file.content(),25*1024*1024).map(buffer->{
      try { byte[] bytes=new byte[buffer.readableByteCount()]; buffer.read(bytes); return bytes; }
      finally { DataBufferUtils.release(buffer); }
    }).switchIfEmpty(Mono.error(Problem.bad("EMPTY_UPLOAD","上传文件为空")))
      .flatMap(bytes->Mono.fromCallable(()->new Inspected(UserFileInspector.inspect(bytes,file.filename()),
          HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes))))
        .subscribeOn(Schedulers.boundedElastic()).flatMap(inspected->{
          String id=UUID.randomUUID().toString(), now=Instant.now().toString();
          String filename=file.filename().replaceAll("[\\\\/\\r\\n\\p{Cntrl}]","_");
          if(filename.isBlank()) filename="attachment";
          if(filename.length()>200) filename=filename.substring(filename.length()-200);
          final String name=filename;
          Mono<Media> persist=lockOwner(owner).then(db.sql("SELECT COUNT(*) n, COALESCE(SUM(byte_size),0) total FROM user_file WHERE owner_id=:owner")
              .bind("owner",owner).map((r,m)->new long[]{r.get("n",Long.class),r.get("total",java.math.BigDecimal.class).longValue()}).one())
            .flatMap(quota->{
              if(quota[0]>=100 || quota[1]+bytes.length>100L*1024*1024)
                return Mono.error(new Problem(413,"FILE_QUOTA_EXCEEDED","每个账号最多 100 个附件，总计 100 MiB"));
              return db.sql("INSERT INTO user_file(id,owner_id,filename,mime,byte_size,created_at,sha256) VALUES(:id,:owner,:name,:mime,:size,:now,:hash)")
                .bind("id",id).bind("owner",owner).bind("name",name).bind("mime",inspected.mime()).bind("size",(long)bytes.length)
                .bind("now",now).bind("hash",inspected.hash()).fetch().rowsUpdated()
                .then(audit.record("USER_FILE_UPLOADED",id)).thenReturn(new Media(id,name,inspected.mime(),bytes.length,now));
            }).as(tx::transactional);
          return storage.put(id,bytes,inspected.mime()).then(persist)
            .onErrorResume(error->storage.delete(id).onErrorComplete().then(Mono.error(error)));
        }));
  }

  public Mono<byte[]> bytes(String id) { return storage.read(id); }

  public Mono<Void> delete(String owner,String id) {
    return lockOwner(owner).then(owned(owner,id))
      .then(db.sql("SELECT COUNT(*) n FROM comment_file f JOIN blog_comment c ON c.id=f.comment_id WHERE f.file_id=:id AND c.deleted=FALSE")
        .bind("id",id).map((r,m)->r.get("n",Long.class)).one())
      .flatMap(n->{
        if(n>0) return Mono.error(Problem.conflict("FILE_REFERENCED","附件仍被评论引用，请先编辑或删除评论"));
        return db.sql("DELETE FROM comment_file WHERE file_id=:id").bind("id",id).fetch().rowsUpdated()
          .then(db.sql("DELETE FROM user_file WHERE id=:id AND owner_id=:owner").bind("id",id).bind("owner",owner).fetch().rowsUpdated())
          .then(audit.record("USER_FILE_DELETED",id));
      }).as(tx::transactional).then(storage.delete(id));
  }

  public Mono<Media> publicFile(String id) {
    return releases.active(null).flatMap(snapshot->
      db.sql("SELECT c.content_id FROM comment_file f JOIN blog_comment c ON c.id=f.comment_id WHERE f.file_id=:id AND c.deleted=FALSE")
        .bind("id",id).map((r,m)->r.get("content_id",String.class)).all()
        .any(content->snapshot.contents().stream().anyMatch(c->c.id().equals(content)))
        .flatMap(ok->ok ? db.sql("SELECT * FROM user_file WHERE id=:id").bind("id",id).map((r,m)->map(r)).one()
          : Mono.empty()).switchIfEmpty(Mono.error(Problem.missing("公开附件不存在")))
        .flatMap(media->releases.active(snapshot.releaseId()).thenReturn(media)));
  }
}
