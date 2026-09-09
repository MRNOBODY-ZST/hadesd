package sh.hades.daemon.content;

import java.time.Instant;
import java.util.UUID;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.media.MediaService;
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

  public ContentService(
      DatabaseClient db,
      ObjectMapper json,
      TransactionalOperator tx,
      AuditService audit,
      MediaService media) {
    this.db = db;
    this.json = json;
    this.tx = tx;
    this.audit = audit;
    this.media = media;
  }

  private Content map(io.r2dbc.spi.Row r) {
    return new Content(
        r.get("id", String.class),
        ContentType.valueOf(r.get("type", String.class)),
        r.get("version", Long.class),
        r.get("created_at", String.class),
        json.readValue(r.get("document", String.class), Revision.class));
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
    Api.bounds(page, size);
    return Mono.zip(
            db.sql(
                    "SELECT c.*,r.document FROM content c JOIN revision r ON"
                        + " r.id=c.latest_revision_id ORDER BY c.created_at DESC,c.id LIMIT :size"
                        + " OFFSET :offset")
                .bind("size", size)
                .bind("offset", (long) page * size)
                .map((r, m) -> map(r))
                .all()
                .collectList(),
            db.sql("SELECT COUNT(*) n FROM content").map((r, m) -> r.get("n", Long.class)).one())
        .map(t -> new Page<>(t.getT1(), page, size, t.getT2()));
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
              validatePage(c.type(), input.slug());
              Revision r =
                  Revision.of(
                      UUID.randomUUID().toString(), id, Instant.now().toString(), input.input());
              return db.sql(
                      "UPDATE content SET version=version+1 WHERE id=:id AND version=:version")
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
