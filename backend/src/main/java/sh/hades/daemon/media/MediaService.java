package sh.hades.daemon.media;

import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import sh.hades.daemon.release.CurrentRelease;
import sh.hades.daemon.search.MySqlSearch;
import reactor.core.publisher.*;
import reactor.core.scheduler.Schedulers;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.shared.Api;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;

@Service
public class MediaService {
  private final DatabaseClient db;
  private final StoragePort storage;
  private final AuditService audit;
  private final TransactionalOperator tx;
  private final CurrentRelease current;

  public MediaService(DatabaseClient db, StoragePort storage, AuditService audit, TransactionalOperator tx, CurrentRelease current) {
    this.db = db;
    this.storage = storage;
    this.audit = audit;
    this.tx = tx;
    this.current = current;
  }

  private Media map(io.r2dbc.spi.Row r) {
    return new Media(
        r.get("id", String.class),
        r.get("filename", String.class),
        r.get("mime", String.class),
        r.get("byte_size", Long.class),
        r.get("created_at", String.class));
  }

  public Mono<Media> get(String id) {
    return db.sql("SELECT * FROM media WHERE id=:id")
        .bind("id", id)
        .map((r, m) -> map(r))
        .one()
        .switchIfEmpty(Mono.error(Problem.missing("附件不存在")));
  }

  public Mono<Page<Media>> list(int page, int size) {
    Api.bounds(page, size);
    return Mono.zip(
            db.sql("SELECT * FROM media ORDER BY created_at DESC,id LIMIT :size OFFSET :offset")
                .bind("size", size)
                .bind("offset", (long) page * size)
                .map((r, m) -> map(r))
                .all()
                .collectList(),
            db.sql("SELECT COUNT(*) n FROM media").map((r, m) -> r.get("n", Long.class)).one())
        .map(t -> new Page<>(t.getT1(), page, size, t.getT2()));
  }

  private record InspectedUpload(String mime, String sha256) {}

  public Mono<Media> upload(FilePart file) {
    return DataBufferUtils.join(file.content(), 25 * 1024 * 1024)
        .map(
            buffer -> {
              try {
                byte[] b = new byte[buffer.readableByteCount()];
                buffer.read(b);
                return b;
              } finally {
                DataBufferUtils.release(buffer);
              }
            })
        .switchIfEmpty(Mono.error(Problem.bad("EMPTY_UPLOAD", "上传文件为空")))
        .flatMap(
            bytes ->
                Mono.fromCallable(
                        () ->
                            new InspectedUpload(
                                sh.hades.daemon.community.UserFileInspector.inspect(bytes, file.filename()),
                                java.util.HexFormat.of()
                                    .formatHex(
                                        java.security.MessageDigest.getInstance("SHA-256")
                                            .digest(bytes))))
                    .subscribeOn(Schedulers.boundedElastic())
                    .flatMap(
                        inspected -> {
                          String mime = inspected.mime();
                          String id = UUID.randomUUID().toString(),
                              now = Instant.now().toString(),
                              filename = file.filename().replaceAll("[\\\\/\\r\\n\\p{Cntrl}]", "_");
                          if (filename.isBlank()) filename = "attachment";
                          if (filename.length() > 200)
                            filename = filename.substring(filename.length() - 200);
                          final String name = filename;
                          return storage
                              .put(id, bytes, mime)
                              .then(
                                  db.sql(
                                          "INSERT INTO"
                                              + " media(id,filename,mime,byte_size,created_at,storage_key,sha256)"
                                              + " VALUES(:id,:name,:mime,:size,:now,:key,:sha256)")
                                      .bind("id", id)
                                      .bind("name", name)
                                      .bind("mime", mime)
                                      .bind("size", (long) bytes.length)
                                      .bind("now", now)
                                      .bind("key", id)
                                      .bind("sha256", inspected.sha256())
                                      .fetch()
                                      .rowsUpdated())
                              .then(audit.record("MEDIA_UPLOADED", id))
                              .thenReturn(new Media(id, name, mime, bytes.length, now))
                              .onErrorResume(
                                  e -> storage.delete(id).onErrorComplete().then(Mono.error(e)));
                        }));
  }

  public Mono<byte[]> bytes(String id) {
    return get(id).then(storage.read(id));
  }

  private static final String REVISION_COUNT = "(SELECT COUNT(*) FROM revision_media v WHERE v.media_id=m.id)";
  private static final String RELEASE_COUNT = "(SELECT COUNT(*) FROM release_media v WHERE v.media_id=m.id)";
  private static final String PROTECTED = "EXISTS(SELECT 1 FROM revision_media v JOIN revision r ON r.id=v.revision_id JOIN content c ON c.id=r.content_id WHERE v.media_id=m.id AND (c.latest_revision_id=r.id OR r.publication_protected=TRUE OR EXISTS(SELECT 1 FROM release_entry e WHERE e.revision_id=r.id))) OR EXISTS(SELECT 1 FROM release_media v WHERE v.media_id=m.id)";

  public Mono<Page<AdminMedia>> listAdmin(int page, int size, String q, String type, String referenced) {
    Api.bounds(page,size);
    if (q.length()>200) throw Problem.bad("INVALID_SEARCH", "搜索词最多 200 个字符");
    String mime = switch(type) {
      case "all" -> "TRUE";
      case "image" -> "m.mime LIKE 'image/%'";
      case "text" -> "(m.mime LIKE 'text/%' OR m.mime IN ('application/json','application/yaml','application/toml'))";
      case "document" -> "m.mime='application/pdf'";
      case "archive" -> "m.mime IN ('application/zip','application/x-zip-compressed')";
      default -> throw Problem.bad("INVALID_MEDIA_TYPE", "附件类型筛选无效");
    };
    if (!Set.of("all","used","unused").contains(referenced)) throw Problem.bad("INVALID_REFERENCE_FILTER", "引用状态筛选无效");
    String count = REVISION_COUNT+"+"+RELEASE_COUNT;
    String from = " FROM media m WHERE (m.filename LIKE :q ESCAPE '!' OR m.id LIKE :q ESCAPE '!') AND ("+mime+")"
        +(referenced.equals("all") ? "" : " AND ("+count+")"+(referenced.equals("used") ? ">0" : "=0"));
    return Mono.zip(
      db.sql("SELECT m.*,("+count+") reference_count,("+PROTECTED+") protected_reference"+from+" ORDER BY m.created_at DESC,m.id LIMIT :size OFFSET :offset")
        .bind("q",MySqlSearch.like(q.trim())).bind("size",size).bind("offset",(long)page*size)
        .map((r,m)->{
          Media value=map(r); long refs=r.get("reference_count",Long.class);
          boolean protect=((Number)r.get("protected_reference")).intValue()!=0;
          return new AdminMedia(value.id(),value.filename(),value.mime(),value.size(),value.createdAt(),refs,refs==0,refs>0&&!protect);
        }).all().collectList(),
      db.sql("SELECT COUNT(*) n"+from).bind("q",MySqlSearch.like(q.trim())).map((r,m)->r.get("n",Long.class)).one())
      .map(t->new Page<>(t.getT1(),page,size,t.getT2()));
  }

  private static final String REFERENCES = "SELECT IF(c.latest_revision_id=r.id,'DRAFT','HISTORY') kind,c.id content_id,r.id revision_id,CAST(NULL AS CHAR(36) CHARACTER SET utf8mb4) COLLATE utf8mb4_bin release_id,JSON_UNQUOTE(JSON_EXTRACT(r.document,'$.title')) COLLATE utf8mb4_bin title,(c.deleted_at IS NOT NULL) deleted,(c.latest_revision_id=r.id) is_current,(c.latest_revision_id=r.id OR r.publication_protected=TRUE OR EXISTS(SELECT 1 FROM release_entry e WHERE e.revision_id=r.id)) protected_ref FROM revision_media v JOIN revision r ON r.id=v.revision_id JOIN content c ON c.id=r.content_id WHERE v.media_id=:id"
      +" UNION ALL SELECT 'RELEASE',NULL,NULL,s.id COLLATE utf8mb4_bin,CONCAT('发布快照 ',s.id) COLLATE utf8mb4_bin,FALSE,(s.id=:active),TRUE FROM release_media v JOIN release_snapshot s ON s.id=v.release_id WHERE v.media_id=:id";

  public Mono<Page<MediaReference>> references(String id, int page, int size) {
    Api.bounds(page,size);
    return get(id).then(current.id()).flatMap(active -> Mono.zip(
      db.sql("SELECT * FROM ("+REFERENCES+") refs ORDER BY kind,content_id,revision_id,release_id LIMIT :size OFFSET :offset")
        .bind("id",id).bind("active",active.orElse("empty")).bind("size",size).bind("offset",(long)page*size)
        .map((r,m)->new MediaReference(r.get("kind",String.class),r.get("content_id",String.class),r.get("revision_id",String.class),r.get("release_id",String.class),r.get("title",String.class),
          ((Number)r.get("deleted")).intValue()!=0,((Number)r.get("is_current")).intValue()!=0,((Number)r.get("protected_ref")).intValue()!=0)).all().collectList(),
      db.sql("SELECT COUNT(*) n FROM ("+REFERENCES+") refs").bind("id",id).bind("active",active.orElse("empty"))
        .map((r,m)->r.get("n",Long.class)).one())
      .map(t->new Page<>(t.getT1(),page,size,t.getT2())));
  }

  public Mono<Void> delete(String id) { return delete(id,false); }

  private Mono<Void> delete(String id, boolean discardHistory) {
    StoragePort.validKey(id);
    // The publisher lock prevents a snapshot from acquiring refs between this check
    // and deletion. The media row lock serializes draft foreign-key references.
    Mono<Void> remove = db.sql("SELECT singleton FROM publisher_lock WHERE singleton=1 FOR UPDATE")
      .map((r,m)->r.get("singleton",Integer.class)).one()
      .then(db.sql("SELECT id FROM media WHERE id=:id FOR UPDATE").bind("id",id).map((r,m)->r.get("id",String.class)).one()
        .switchIfEmpty(Mono.error(Problem.missing("附件不存在"))))
      .then(db.sql("SELECT ("+REVISION_COUNT+"+"+RELEASE_COUNT+") reference_count,("+PROTECTED+") protected_reference FROM media m WHERE m.id=:id")
        .bind("id",id).map((r,m)->new long[]{r.get("reference_count",Long.class),((Number)r.get("protected_reference")).longValue()}).one())
      .flatMap(counts -> {
        if (counts[0]>0 && (!discardHistory || counts[1]>0))
          return references(id,0,3).flatMap(refs -> Mono.error(Problem.conflict("MEDIA_REFERENCED", "附件仍被引用："+refs.items().stream().map(ref->ref.title()+" ["+ref.kind()+"]").reduce((a,b)->a+"；"+b).orElse("保留的修订或发布快照")+"。最新草稿、回收站文稿与发布历史均受保护。")));
        return db.sql("DELETE FROM revision_media WHERE media_id=:id").bind("id",id).fetch().rowsUpdated()
          .then(db.sql("INSERT INTO media_deletion_queue(media_id,created_at) VALUES(:id,:now)").bind("id",id).bind("now",Instant.now().toString()).fetch().rowsUpdated())
          .then(db.sql("DELETE FROM media WHERE id=:id").bind("id",id).fetch().rowsUpdated())
          .then(audit.record(discardHistory && counts[0]>0 ? "MEDIA_HISTORY_DISCARDED" : "MEDIA_DELETED",id));
      }).then().as(tx::transactional);
    // Persisted cleanup survives an object-store outage or a process crash after commit.
    return remove.then(cleanDeletedObject(id)).onErrorMap(error -> error instanceof Problem ? error
        : new Problem(503,"MEDIA_DELETE_FAILED","附件删除未完成，请刷新媒体库后重试；已移除的对象会继续后台回收"));
  }

  public Mono<MediaBatchDeleteResult> batchDelete(MediaBatchDelete input) {
    if (input.ids()==null || input.ids().isEmpty() || input.ids().size()>50 || new HashSet<>(input.ids()).size()!=input.ids().size())
      return Mono.error(Problem.bad("INVALID_BATCH", "每批选择 1–50 个不同附件"));
    for (String id:input.ids()) StoragePort.validKey(id);
    return Flux.fromIterable(input.ids()).concatMap(id -> delete(id,input.discardUnusedHistory())
      .thenReturn(new MediaDeleteResult(id,"DELETED",null,"附件已删除"))
      .onErrorResume(error -> {
        String code=error instanceof Problem p?p.code:"MEDIA_DELETE_FAILED";
        String status=code.equals("MEDIA_REFERENCED")?"REFERENCED":error instanceof Problem p&&p.status==404?"NOT_FOUND":"FAILED";
        return Mono.just(new MediaDeleteResult(id,status,code,error instanceof Problem?error.getMessage():"附件删除失败，请重试"));
      })).collectList().map(MediaBatchDeleteResult::new);
  }

  private Mono<Void> cleanDeletedObject(String id) {
    return storage.delete(id).then(db.sql("DELETE FROM media_deletion_queue WHERE media_id=:id").bind("id",id).fetch().rowsUpdated()).then();
  }

  public Mono<Void> retryDeletes() {
    return db.sql("SELECT media_id FROM media_deletion_queue ORDER BY created_at,media_id LIMIT 50")
      .map((r,m)->r.get("media_id",String.class)).all()
      .concatMap(id -> cleanDeletedObject(id).onErrorComplete()).then();
  }

  public Mono<Void> verifyAvailable(Set<String> ids) {
    return Flux.fromIterable(ids)
        .concatMap(
            id ->
                get(id)
                    .flatMap(m -> storage.exists(id))
                    .flatMap(
                        ok ->
                            ok
                                ? Mono.empty()
                                : Mono.error(Problem.conflict("MEDIA_UNAVAILABLE", "发布引用的附件暂不可用"))))
        .then();
  }

  public Mono<Boolean> isPublic(String releaseId, String id) {
    return db.sql("SELECT COUNT(*) n FROM release_media WHERE release_id=:rid AND media_id=:mid")
        .bind("rid", releaseId)
        .bind("mid", id)
        .map((r, m) -> r.get("n", Long.class) > 0)
        .one();
  }

  public Mono<Void> linkRevision(Revision revision) {
    var refs = references(revision.markdown(), revision.coverMediaId());
    return Flux.fromIterable(new TreeSet<>(refs)).concatMap(id -> db.sql("SELECT id FROM media WHERE id=:id FOR UPDATE").bind("id",id).map((r,m)->r.get("id",String.class)).one().switchIfEmpty(Mono.error(Problem.missing("引用的附件不存在")))).then()
        .then(verifyAvailable(refs))
        .thenMany(
            Flux.fromIterable(refs)
                .concatMap(
                    id ->
                        db.sql("INSERT INTO revision_media(revision_id,media_id) VALUES(:rid,:mid)")
                            .bind("rid", revision.id())
                            .bind("mid", id)
                            .fetch()
                            .rowsUpdated()))
        .then().as(tx::transactional);
  }

  public static Set<String> references(String markdown, String coverMediaId) {
    return references(
        List.of(
            new PublicContent(
                "",
                ContentType.POST,
                "",
                "",
                "",
                "",
                "",
                "",
                "",
                markdown,
                List.of(),
                "",
                coverMediaId)));
  }

  private static final Pattern REFERENCE =
      Pattern.compile("/api/v1/(?:public/media/|admin/media/)([0-9a-fA-F-]{36})(?:/content)?");

  public static Set<String> references(List<PublicContent> contents) {
    Set<String> refs = new LinkedHashSet<>();
    for (var c : contents) {
      if (c.coverMediaId() != null && !c.coverMediaId().isBlank()) {
        try {
          refs.add(UUID.fromString(c.coverMediaId()).toString());
        } catch (Exception e) {
          throw Problem.bad("INVALID_MEDIA_ID", "封面附件 ID 无效");
        }
      }
      var match = REFERENCE.matcher(c.markdown());
      while (match.find()) {
        try {
          refs.add(UUID.fromString(match.group(1)).toString());
        } catch (Exception e) {
          throw Problem.bad("INVALID_MEDIA_ID", "正文附件 ID 无效");
        }
      }
    }
    return refs;
  }
}
