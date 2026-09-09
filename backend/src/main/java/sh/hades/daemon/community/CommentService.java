package sh.hades.daemon.community;

import java.time.Instant;
import java.util.*;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.*;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.community.CommunityApi.*;
import sh.hades.daemon.release.ReleaseService;
import sh.hades.daemon.shared.Api;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;

@Service
public class CommentService {
  private final DatabaseClient db;
  private final TransactionalOperator tx;
  private final ReleaseService releases;
  private final UserFileService files;
  private final AuditService audit;
  private static final String SELECT = "SELECT c.*,a.username,a.display_name,a.role FROM blog_comment c JOIN blog_account a ON a.id=c.author_id ";

  public CommentService(DatabaseClient db, TransactionalOperator tx, ReleaseService releases, UserFileService files, AuditService audit) {
    this.db=db; this.tx=tx; this.releases=releases; this.files=files; this.audit=audit;
  }

  private Comment map(io.r2dbc.spi.Row row) {
    return new Comment(row.get("id",String.class), row.get("content_id",String.class), row.get("parent_id",String.class), row.get("body",String.class),
        new User(row.get("author_id",String.class),row.get("username",String.class),row.get("display_name",String.class),row.get("role",String.class)),
        List.of(),row.get("created_at",String.class),row.get("updated_at",String.class));
  }

  private Mono<Comment> attachments(Comment comment) {
    return db.sql("SELECT f.* FROM user_file f JOIN comment_file cf ON cf.file_id=f.id WHERE cf.comment_id=:id ORDER BY f.created_at,f.id")
        .bind("id",comment.id()).map((r,m)->UserFileService.map(r)).all().collectList()
        .map(items->new Comment(comment.id(),comment.contentId(),comment.parentId(),comment.body(),comment.author(),items,comment.createdAt(),comment.updatedAt()));
  }

  private Mono<Comment> row(String id, String owner, boolean lock) {
    // Lock only the comment, not the joined author's account. All mutations already
    // lock their owning account first; replies must not introduce the opposite order.
    if (lock) {
      var lockQuery=db.sql("SELECT id FROM blog_comment WHERE id=:id AND deleted=FALSE"+(owner==null?"":" AND author_id=:owner")+" FOR UPDATE").bind("id",id);
      if(owner!=null) lockQuery=lockQuery.bind("owner",owner);
      return lockQuery.map((r,m)->r.get("id",String.class)).one()
          .switchIfEmpty(Mono.error(Problem.missing("评论不存在"))).then(Mono.defer(()->row(id,owner,false)));
    }
    var query=db.sql(SELECT+"WHERE c.id=:id AND c.deleted=FALSE"+(owner==null?"":" AND c.author_id=:owner")).bind("id",id);
    if(owner!=null) query=query.bind("owner",owner);
    return query.map((r,m)->map(r)).one().switchIfEmpty(Mono.error(Problem.missing("评论不存在")));
  }

  private Mono<ReleaseSnapshot> published(String id) {
    return releases.active(null).flatMap(snapshot->snapshot.contents().stream().anyMatch(c->c.id().equals(id))
        ? Mono.just(snapshot) : Mono.error(Problem.missing("公开内容不存在")));
  }

  private Mono<Page<Comment>> page(String filter, String value, int page, int size, boolean ascending) {
    Api.bounds(page,size);
    String where=" WHERE c.deleted=FALSE"+(filter==null?"":" AND c."+filter+"=:value");
    var query=db.sql(SELECT+where+" ORDER BY c.created_at "+(ascending?"ASC":"DESC")+",c.id LIMIT :size OFFSET :offset")
        .bind("size",size).bind("offset",(long)page*size);
    var count=db.sql("SELECT COUNT(*) n FROM blog_comment c"+where);
    if(filter!=null) { query=query.bind("value",value); count=count.bind("value",value); }
    return Mono.zip(query.map((r,m)->map(r)).all().concatMap(this::attachments).collectList(),
        count.map((r,m)->r.get("n",Long.class)).one()).map(t->new Page<>(t.getT1(),page,size,t.getT2()));
  }

  public Mono<Page<Comment>> publicComments(String contentId,int page,int size) {
    return published(contentId).flatMap(snapshot->page("content_id",contentId,page,size,true)
        .flatMap(result->releases.active(snapshot.releaseId()).thenReturn(result)));
  }

  public Mono<Page<Comment>> ownComments(String owner,int page,int size) { return page("author_id",owner,page,size,false); }
  public Mono<Page<Comment>> adminComments(String contentId,int page,int size) { return page(contentId==null?null:"content_id",contentId,page,size,false); }

  private static String body(String body) {
    if(body==null || body.strip().isEmpty() || body.length()>4000 || body.codePoints().anyMatch(cp->Character.isISOControl(cp)&&cp!='\n'&&cp!='\r'&&cp!='\t'))
      throw Problem.bad("INVALID_COMMENT","评论应为 1–4000 个字符，不能包含控制字符");
    return body.strip();
  }

  private static String uuid(String id) {
    if(id==null || !id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))
      throw Problem.bad("INVALID_ID","标识格式无效");
    return UUID.fromString(id).toString();
  }

  private Mono<Void> replaceAttachments(String commentId,String owner,List<String> ids) {
    if(ids==null) return Mono.empty();
    if(ids.size()>4 || new HashSet<>(ids).size()!=ids.size()) return Mono.error(Problem.bad("INVALID_ATTACHMENTS","最多 4 个不重复的附件"));
    var normalized=ids.stream().map(CommentService::uuid).sorted().toList();
    return Flux.fromIterable(normalized).concatMap(id->files.owned(owner,id)).then()
        .then(db.sql("DELETE FROM comment_file WHERE comment_id=:id").bind("id",commentId).fetch().rowsUpdated())
        .thenMany(Flux.fromIterable(normalized).concatMap(id->db.sql("INSERT INTO comment_file(comment_id,file_id) VALUES(:comment,:file)")
            .bind("comment",commentId).bind("file",id).fetch().rowsUpdated())).then();
  }

  public Mono<Comment> create(String owner,String contentId,CreateComment input) {
    return Mono.defer(()->{
      String body=body(input.body());
      String parent=input.parentId()==null?null:uuid(input.parentId());
      String id=UUID.randomUUID().toString(), now=Instant.now().toString();
      return published(contentId).flatMap(snapshot->{
        Mono<Void> checkParent=parent==null?Mono.empty():row(parent,null,true).flatMap(comment->{
          if(!comment.contentId().equals(contentId) || comment.parentId()!=null)
            return Mono.error(Problem.bad("INVALID_PARENT","只能回复当前文章的一级评论"));
          return Mono.empty();
        });
        var insert=db.sql("INSERT INTO blog_comment(id,content_id,author_id,parent_id,body,created_at,updated_at) VALUES(:id,:content,:owner,:parent,:body,:now,:now)")
            .bind("id",id).bind("content",contentId).bind("owner",owner).bind("body",body).bind("now",now);
        insert=parent==null?insert.bindNull("parent",String.class):insert.bind("parent",parent);
        return files.lockOwner(owner).then(checkParent).then(insert.fetch().rowsUpdated())
            .then(replaceAttachments(id,owner,input.attachmentIds()))
            .then(audit.record("COMMENT_CREATED",id)).then(row(id,owner,false)).flatMap(this::attachments)
            .flatMap(comment->releases.active(snapshot.releaseId()).thenReturn(comment)).as(tx::transactional);
      });
    });
  }

  public Mono<Comment> edit(String owner,String id,EditComment input) {
    return Mono.defer(()->{
      String body=body(input.body());
      return files.lockOwner(owner).then(row(id,owner,true)).flatMap(existing->published(existing.contentId())
          .flatMap(snapshot->db.sql("UPDATE blog_comment SET body=:body,updated_at=:now WHERE id=:id AND author_id=:owner AND deleted=FALSE")
              .bind("body",body).bind("now",Instant.now().toString()).bind("id",id).bind("owner",owner).fetch().rowsUpdated()
              .then(replaceAttachments(id,owner,input.attachmentIds())).then(audit.record("COMMENT_EDITED",id))
              .then(row(id,owner,false)).flatMap(this::attachments)
              .flatMap(comment->releases.active(snapshot.releaseId()).thenReturn(comment)))).as(tx::transactional);
    });
  }

  public Mono<Void> delete(String owner,String id) {
    return row(id,owner,false).flatMap(comment->files.lockOwner(comment.author().id()).then(row(id,owner,true))
        .then(db.sql("UPDATE blog_comment SET deleted=TRUE,body='',updated_at=:now WHERE id=:id")
            .bind("now",Instant.now().toString()).bind("id",id).fetch().rowsUpdated())
        .then(db.sql("DELETE FROM comment_file WHERE comment_id=:id").bind("id",id).fetch().rowsUpdated())
        .then(audit.record(owner==null?"COMMENT_MODERATED":"COMMENT_DELETED",id)).as(tx::transactional));
  }
}
