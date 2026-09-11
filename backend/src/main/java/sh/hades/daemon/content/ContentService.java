package sh.hades.daemon.content;

import java.time.Instant;
import java.util.UUID;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.media.MediaService;
import sh.hades.daemon.release.CurrentRelease;
import sh.hades.daemon.search.MySqlSearch;
import sh.hades.daemon.shared.Api;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

@Service
public class ContentService {
  private final DatabaseClient db;
  private final ObjectMapper json;
  private final TransactionalOperator tx;
  private final AuditService audit;
  private final MediaService media;
  private final CurrentRelease current;

  public ContentService(
      DatabaseClient db,
      ObjectMapper json,
      TransactionalOperator tx,
      AuditService audit,
      MediaService media, CurrentRelease current) {
    this.db = db;
    this.json = json;
    this.tx = tx;
    this.audit = audit;
    this.media = media;
    this.current = current;
  }

  private Content map(io.r2dbc.spi.Row r) {
    return new Content(
        r.get("id", String.class),
        ContentType.valueOf(r.get("type", String.class)),
        r.get("version", Long.class),
        r.get("created_at", String.class),
        json.readValue(r.get("document", String.class), Revision.class), r.get("deleted_at", String.class));
  }

  public Mono<Content> get(String id) {
    return db.sql(
            "SELECT c.*,r.document FROM content c JOIN revision r ON r.id=c.latest_revision_id"
                + " WHERE c.id=:id")
        .bind("id", id)
        .map((r, m) -> map(r))
        .one()
        .switchIfEmpty(Mono.error(Problem.missing("内容不存在")));
  }

  public Mono<Page<Content>> list(int page, int size) {
    return list(page, size, "", "all", false);
  }

  public Mono<Page<Content>> list(int page, int size, String q, String type, boolean trash) {
    Api.bounds(page, size);
    if (q.length()>200) throw Problem.bad("INVALID_SEARCH", "搜索词最多 200 个字符");
    if (!java.util.Set.of("all", "POST", "PROJECT", "RESEARCH", "PAGE").contains(type))
      throw Problem.bad("INVALID_CONTENT_TYPE", "文稿类型无效");
    String from = " FROM content c JOIN revision r ON r.id=c.latest_revision_id WHERE c.deleted_at IS "
        + (trash ? "NOT NULL" : "NULL")
        + " AND (:type='all' OR c.type=:type) AND (LOWER(JSON_UNQUOTE(JSON_EXTRACT(r.document,'$.title'))) LIKE LOWER(:q) ESCAPE '!'"
        + " OR LOWER(JSON_UNQUOTE(JSON_EXTRACT(r.document,'$.slug'))) LIKE LOWER(:q) ESCAPE '!')";
    return Mono.zip(
        db.sql("SELECT c.*,r.document"+from+" ORDER BY c.created_at DESC,c.id LIMIT :size OFFSET :offset")
          .bind("type",type).bind("q",MySqlSearch.like(q.trim())).bind("size",size).bind("offset",(long)page*size)
          .map((r,m)->map(r)).all().collectList(),
        db.sql("SELECT COUNT(*) n"+from).bind("type",type).bind("q",MySqlSearch.like(q.trim()))
          .map((r,m)->r.get("n",Long.class)).one())
        .map(t->new Page<>(t.getT1(),page,size,t.getT2()));
  }

  public Mono<Void> requireActive(String id) {
    return get(id).flatMap(c -> c.deletedAt()==null ? Mono.empty()
        : Mono.error(Problem.conflict("CONTENT_DELETED", "文稿已在回收站，请先恢复再编辑或发布")));
  }

  public Mono<Void> delete(String id, long version) {
    if (version<1) return Mono.error(Problem.bad("INVALID_VERSION", "缺少有效的文稿版本"));
    return db.sql("SELECT singleton FROM publisher_lock WHERE singleton=1 FOR UPDATE")
        .map((r,m)->r.get("singleton",Integer.class)).one()
        .then(db.sql("SELECT COUNT(*) n FROM publish_job WHERE status NOT IN ('SUCCEEDED','FAILED')")
          .map((r,m)->r.get("n",Long.class)).one())
        .flatMap(busy -> busy>0 ? Mono.error(Problem.conflict("PUBLISH_BUSY", "发布任务尚未结束，请完成后再移动文稿到回收站")) : current.id())
        .flatMap(active -> db.sql("SELECT COUNT(*) n FROM release_entry WHERE release_id=:rid AND content_id=:id")
          .bind("rid",active.orElse("empty")).bind("id",id).map((r,m)->r.get("n",Long.class)).one())
        .flatMap(published -> published>0 ? Mono.error(Problem.conflict("CONTENT_PUBLISHED", "此文稿仍在线上，请先撤稿并等待发布完成，再移动到回收站")) : get(id))
        .flatMap(c -> {
          if (c.deletedAt()!=null) return Mono.empty();
          return db.sql("UPDATE content SET deleted_at=:now,version=version+1 WHERE id=:id AND version=:version AND deleted_at IS NULL")
            .bind("now",Instant.now().toString()).bind("id",id).bind("version",version).fetch().rowsUpdated()
            .flatMap(n -> n==1 ? audit.record("CONTENT_TRASHED",id)
              : Mono.error(Problem.conflict("REVISION_CONFLICT", "文稿已变化，请刷新后再删除")));
        }).then().as(tx::transactional);
  }

  public Mono<Content> restore(String id, long version) {
    return get(id).flatMap(c -> {
      if (c.deletedAt()==null) return Mono.error(Problem.conflict("CONTENT_NOT_DELETED", "文稿不在回收站"));
      return db.sql("UPDATE content SET deleted_at=NULL,version=version+1 WHERE id=:id AND version=:version AND deleted_at IS NOT NULL")
        .bind("id",id).bind("version",version).fetch().rowsUpdated()
        .flatMap(n -> n==1 ? audit.record("CONTENT_RESTORED",id)
          : Mono.error(Problem.conflict("REVISION_CONFLICT", "文稿已变化，请刷新后再恢复")))
        .then(get(id));
    }).as(tx::transactional);
  }

  public Mono<Void> purge(String id,long version) {
    if(version<1) return Mono.error(Problem.bad("INVALID_VERSION","缺少有效的文稿版本"));
    return db.sql("SELECT singleton FROM publisher_lock WHERE singleton=1 FOR UPDATE")
      .map((r,m)->r.get("singleton",Integer.class)).one()
      .then(db.sql("SELECT COUNT(*) n FROM publish_job WHERE status NOT IN ('SUCCEEDED','FAILED')").map((r,m)->r.get("n",Long.class)).one())
      .flatMap(n->n>0?Mono.error(Problem.conflict("PUBLISH_BUSY","发布任务尚未结束，请稍后再永久删除文稿")):
        db.sql("SELECT id FROM content WHERE id=:id FOR UPDATE").bind("id",id).map((r,m)->r.get("id",String.class)).one()
          .switchIfEmpty(Mono.error(Problem.missing("文稿不存在"))))
      .then(get(id)).flatMap(c->{
        if(c.deletedAt()==null) return Mono.error(Problem.conflict("CONTENT_NOT_DELETED","请先将文稿移入回收站"));
        if(c.version()!=version) return Mono.error(Problem.conflict("REVISION_CONFLICT","文稿已变化，请刷新后再永久删除"));
        return db.sql("SELECT (SELECT COUNT(*) FROM revision WHERE content_id=:id AND publication_protected=TRUE)+(SELECT COUNT(*) FROM release_entry WHERE content_id=:id)+(SELECT COUNT(*) FROM blog_comment WHERE content_id=:id) n")
          .bind("id",id).map((r,m)->r.get("n",Long.class)).one()
          .flatMap(refs->{
            if(refs>0) return Mono.error(Problem.conflict("CONTENT_HISTORY_PROTECTED","文稿仍有发布历史、保留快照或评论引用，不能永久删除；请保留在回收站"));
            return db.sql("UPDATE content SET latest_revision_id=NULL WHERE id=:id").bind("id",id).fetch().rowsUpdated()
              .then(db.sql("DELETE v FROM revision_media v JOIN revision r ON r.id=v.revision_id WHERE r.content_id=:id").bind("id",id).fetch().rowsUpdated())
              .then(db.sql("DELETE FROM revision WHERE content_id=:id").bind("id",id).fetch().rowsUpdated())
              .then(db.sql("DELETE FROM content WHERE id=:id").bind("id",id).fetch().rowsUpdated())
              .then(audit.record("CONTENT_PURGED",id));
          });
      }).then().as(tx::transactional);
  }

  public Mono<Content> create(CreateContent input) {
    validatePage(input.type(), input.slug());
    String id = UUID.randomUUID().toString(), now = Instant.now().toString();
    Revision r = Revision.of(UUID.randomUUID().toString(), id, now, input.input());
    return db.sql("INSERT INTO content(id,type,version,created_at) VALUES(:id,:type,1,:now)")
        .bind("id", id)
        .bind("type", input.type().name())
        .bind("now", now)
        .fetch()
        .rowsUpdated()
        .then(insert(r))
        .then(media.linkRevision(r))
        .then(
            db.sql("UPDATE content SET latest_revision_id=:rid WHERE id=:id")
                .bind("rid", r.id())
                .bind("id", id)
                .fetch()
                .rowsUpdated())
        .then(audit.record("CONTENT_CREATED", id))
        .then(get(id))
        .as(tx::transactional);
  }

  public Mono<Content> save(String id, SaveRevision input) {
    return get(id)
        .flatMap(
            c -> {
              if (c.deletedAt()!=null) return Mono.error(Problem.conflict("CONTENT_DELETED", "文稿已在回收站，请先恢复"));
              validatePage(c.type(), input.slug());
              Revision r =
                  Revision.of(
                      UUID.randomUUID().toString(), id, Instant.now().toString(), input.input());
              return db.sql(
                      "UPDATE content SET version=version+1 WHERE id=:id AND version=:version AND deleted_at IS NULL")
                  .bind("id", id)
                  .bind("version", input.version())
                  .fetch()
                  .rowsUpdated()
                  .flatMap(
                      n ->
                          n == 1
                              ? insert(r)
                              : Mono.error(
                                  Problem.conflict("REVISION_CONFLICT", "此内容已在其他窗口更新，请加载最新修订后再保存")))
                  .then(media.linkRevision(r))
                  .then(
                      db.sql("UPDATE content SET latest_revision_id=:rid WHERE id=:id")
                          .bind("rid", r.id())
                          .bind("id", id)
                          .fetch()
                          .rowsUpdated())
                  .then(audit.record("REVISION_SAVED", r.id()))
                  .then(get(id));
            })
        .as(tx::transactional);
  }

  private Mono<Long> insert(Revision r) {
    return db.sql(
            "INSERT INTO revision(id,content_id,created_at,document) VALUES(:id,:cid,:now,:doc)")
        .bind("id", r.id())
        .bind("cid", r.contentId())
        .bind("now", r.createdAt())
        .bind("doc", json.writeValueAsString(r))
        .fetch()
        .rowsUpdated();
  }

  public Mono<Revision> revision(String id, String rid) {
    return db.sql("SELECT document FROM revision WHERE id=:rid AND content_id=:id")
        .bind("rid", rid)
        .bind("id", id)
        .map((r, m) -> json.readValue(r.get("document", String.class), Revision.class))
        .one()
        .switchIfEmpty(Mono.error(Problem.missing("修订不存在")));
  }

  public Mono<Page<Revision>> revisions(String id, int page, int size) {
    Api.bounds(page, size);
    return get(id)
        .then(
            Mono.zip(
                    db.sql(
                            "SELECT document FROM revision WHERE content_id=:id ORDER BY created_at"
                                + " DESC,id LIMIT :size OFFSET :offset")
                        .bind("id", id)
                        .bind("size", size)
                        .bind("offset", (long) page * size)
                        .map(
                            (r, m) ->
                                json.readValue(r.get("document", String.class), Revision.class))
                        .all()
                        .collectList(),
                    db.sql("SELECT COUNT(*) n FROM revision WHERE content_id=:id")
                        .bind("id", id)
                        .map((r, m) -> r.get("n", Long.class))
                        .one())
                .map(t -> new Page<>(t.getT1(), page, size, t.getT2())));
  }

  private void validatePage(ContentType type, String slug) {
    if (type == ContentType.PAGE && !java.util.Set.of("about", "now").contains(slug))
      throw Problem.bad("INVALID_PAGE_SLUG", "页面仅支持 about 或 now，避免与系统路由冲突");
  }
}
