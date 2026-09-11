package sh.hades.daemon.release;

import java.time.Instant;
import java.util.*;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.*;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.content.ContentService;
import sh.hades.daemon.media.MediaService;
import sh.hades.daemon.settings.SettingsService;
import sh.hades.daemon.shared.Api;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

@Service
public class ReleaseService {
  private final DatabaseClient db;
  private final ObjectMapper json;
  private final TransactionalOperator tx;
  private final CurrentRelease current;
  private final ContentService content;
  private final SettingsService settings;
  private final MediaService media;
  private final AuditService audit;
  private final org.springframework.data.redis.core.ReactiveStringRedisTemplate redis;

  public ReleaseService(
      DatabaseClient db,
      ObjectMapper json,
      TransactionalOperator tx,
      CurrentRelease current,
      ContentService content,
      SettingsService settings,
      MediaService media,
      AuditService audit,
      org.springframework.data.redis.core.ReactiveStringRedisTemplate redis) {
    this.db = db;
    this.json = json;
    this.tx = tx;
    this.current = current;
    this.content = content;
    this.settings = settings;
    this.media = media;
    this.audit = audit;
    this.redis = redis;
  }

  public Mono<ReleaseSnapshot> snapshot(String id) {
    return db.sql("SELECT document FROM release_snapshot WHERE id=:id AND retained=1")
        .bind("id", id)
        .map((r, m) -> json.readValue(r.get("document", String.class), ReleaseSnapshot.class))
        .one()
        .switchIfEmpty(Mono.error(Problem.missing("发布快照不存在")));
  }

  public Mono<ReleaseSnapshot> active(String expected) {
    return current
        .id()
        .flatMap(
            id -> {
              if (expected != null && !expected.equals(id.orElse("empty")))
                return Mono.error(Problem.conflict("RELEASE_CHANGED", "站点版本已更新，请刷新后重试"));
              return id.map(this::cachedSnapshot)
                  .orElseGet(
                      () ->
                          Mono.just(
                              new ReleaseSnapshot(
                                  "empty", "", SiteSettings.defaults(), List.of())));
            });
  }

  private Mono<ReleaseSnapshot> cachedSnapshot(String id) {
    String key = "hadesd:public:" + id + ":snapshot";
    return redis
        .opsForValue()
        .get(key)
        .timeout(java.time.Duration.ofSeconds(2))
        .onErrorResume(e -> Mono.empty())
        .flatMap(
            value -> {
              try {
                var s = json.readValue(value, ReleaseSnapshot.class);
                return id.equals(s.releaseId()) ? Mono.just(s) : Mono.<ReleaseSnapshot>empty();
              } catch (Exception e) {
                return Mono.empty();
              }
            })
        .switchIfEmpty(
            Mono.defer(
                () ->
                    snapshot(id)
                        .flatMap(
                            s ->
                                redis
                                    .opsForValue()
                                    .set(
                                        key,
                                        json.writeValueAsString(s),
                                        java.time.Duration.ofMinutes(5))
                                    .timeout(java.time.Duration.ofSeconds(2))
                                    .onErrorReturn(false)
                                    .thenReturn(s))));
  }

  public Mono<ReleaseInfo> info() {
    return active(null)
        .map(
            s ->
                new ReleaseInfo(
                    s.releaseId().equals("empty") ? "EMPTY" : "ACTIVE",
                    s.releaseId().equals("empty") ? null : s.releaseId(),
                    s.createdAt().isEmpty() ? null : s.createdAt()));
  }

  private Mono<Void> lock() {
    return db.sql("SELECT singleton FROM publisher_lock WHERE singleton=1 FOR UPDATE")
        .map((r, m) -> r.get("singleton", Integer.class))
        .one()
        .then();
  }

  public Mono<PublishJob> create(PublishRequest req) {
    validate(req);
    return lock()
        .then(reconcile())
        .then(
            db.sql("SELECT COUNT(*) n FROM publish_job WHERE status NOT IN ('SUCCEEDED','FAILED')")
                .map((r, m) -> r.get("n", Long.class))
                .one())
        .flatMap(
            n -> {
              if (n > 0) return Mono.error(Problem.conflict("PUBLISH_BUSY", "已有发布任务，请等待完成或租约恢复"));
              return freeze(req);
            })
        .flatMap(s -> persist(s, req.operation()))
        .as(tx::transactional);
  }

  private void validate(PublishRequest r) {
    if (r.operation() == null) throw Problem.bad("INVALID_OPERATION", "请选择发布操作");
    if (r.operation() == Operation.PUBLISH && (r.contentId() == null || r.revisionId() == null)
        || r.operation() == Operation.WITHDRAW && r.contentId() == null
        || r.operation() == Operation.ROLLBACK && r.releaseId() == null)
      throw Problem.bad("MISSING_TARGET", "发布操作缺少明确的目标 ID");
  }

  private Mono<ReleaseSnapshot> freeze(PublishRequest req) {
    String rid = UUID.randomUUID().toString(), now = Instant.now().toString();
    if (req.operation() == Operation.ROLLBACK)
      return snapshot(req.releaseId())
          .flatMap(s -> Flux.fromIterable(s.contents()).concatMap(c -> content.requireActive(c.id())).then(Mono.just(s)))
          .flatMap(
              s ->
                  db.sql(
                          "SELECT COUNT(*) n FROM publish_job WHERE release_id=:id AND"
                              + " status='SUCCEEDED'")
                      .bind("id", req.releaseId())
                      .map((r, m) -> r.get("n", Long.class))
                      .one()
                      .flatMap(
                          n ->
                              n == 0
                                  ? Mono.error(Problem.bad("NOT_DEPLOYED", "只能回滚已上线版本"))
                                  : Mono.just(
                                      new ReleaseSnapshot(rid, now, s.site(), s.contents()))));
    return Mono.zip(active(null), settings.get())
        .flatMap(
            t -> {
              var old = t.getT1();
              var items = new ArrayList<>(old.contents());
              if (req.operation() == Operation.SETTINGS)
                return Mono.just(new ReleaseSnapshot(rid, now, t.getT2(), items));
              if (req.operation() == Operation.INITIALIZE) {
                if (!old.releaseId().equals("empty"))
                  return Mono.error(Problem.conflict("ALREADY_INITIALIZED", "站点已初始化，请使用发布操作"));
                return Mono.just(new ReleaseSnapshot(rid, now, t.getT2(), items));
              }
              if (req.operation() == Operation.WITHDRAW) {
                if (!items.removeIf(i -> i.id().equals(req.contentId())))
                  return Mono.error(Problem.missing("当前线上版本没有此内容"));
                return Mono.just(new ReleaseSnapshot(rid, now, t.getT2(), items));
              }
              return Mono.zip(
                      content.requireActive(req.contentId()).then(content.get(req.contentId())),
                      content.revision(req.contentId(), req.revisionId()))
                  .map(
                      pair -> {
                        var c = pair.getT1();
                        var r = pair.getT2();
                        String published =
                            items.stream()
                                .filter(i -> i.id().equals(c.id()))
                                .map(PublicContent::publishedAt)
                                .findFirst()
                                .orElse(now);
                        items.removeIf(i -> i.id().equals(c.id()));
                        String route = Api.route(c.type(), r.slug());
                        if (items.stream().anyMatch(i -> i.route().equals(route)))
                          throw Problem.conflict("SLUG_CONFLICT", "此公开路径已被其他内容使用");
                        items.add(
                            new PublicContent(
                                c.id(),
                                c.type(),
                                r.id(),
                                route,
                                published,
                                now,
                                r.title(),
                                r.slug(),
                                r.summary(),
                                r.markdown(),
                                r.tags(),
                                r.language(),
                                r.coverMediaId()));
                        items.sort(
                            Comparator.comparing(PublicContent::publishedAt)
                                .reversed()
                                .thenComparing(PublicContent::id));
                        return new ReleaseSnapshot(rid, now, t.getT2(), items);
                      });
            });
  }

  private Mono<PublishJob> persist(ReleaseSnapshot s, Operation op) {
    String jid = UUID.randomUUID().toString();
    Set<String> refs = MediaService.references(s.contents());
    return media
        .verifyAvailable(refs)
        .then(
            db.sql("INSERT INTO release_snapshot(id,created_at,document) VALUES(:id,:now,:doc)")
                .bind("id", s.releaseId())
                .bind("now", s.createdAt())
                .bind("doc", json.writeValueAsString(s))
                .fetch()
                .rowsUpdated())
        .thenMany(
            Flux.fromIterable(s.contents())
                .concatMap(
                    c ->
                        db.sql(
                                "INSERT INTO"
                                    + " release_entry(release_id,content_id,revision_id,route,title,summary,plain_text,tags)"
                                    + " VALUES(:rid,:cid,:vid,:route,:title,:summary,:plain,:tags)")
                            .bind("rid", s.releaseId())
                            .bind("cid", c.id())
                            .bind("vid", c.revisionId())
                            .bind("route", c.route())
                            .bind("title", c.title())
                            .bind("summary", c.summary())
                            .bind("plain", c.markdown().replaceAll("[\\p{Punct}&&[^+#.]]", " "))
                            .bind("tags", String.join(" ", c.tags()))
                            .fetch()
                            .rowsUpdated()))
        .thenMany(
            Flux.fromIterable(refs)
                .concatMap(
                    mid ->
                        db.sql("INSERT INTO release_media(release_id,media_id) VALUES(:rid,:mid)")
                            .bind("rid", s.releaseId())
                            .bind("mid", mid)
                            .fetch()
                            .rowsUpdated()))
        .then(
            db.sql(
                    "INSERT INTO publish_job(id,release_id,operation,status,created_at)"
                        + " VALUES(:id,:rid,:op,'QUEUED',:now)")
                .bind("id", jid)
                .bind("rid", s.releaseId())
                .bind("op", op.name())
                .bind("now", s.createdAt())
                .fetch()
                .rowsUpdated())
        .then(audit.record("PUBLISH_QUEUED", jid))
        .then(job(jid));
  }

  private PublishJob map(io.r2dbc.spi.Row r, boolean lease) {
    return new PublishJob(
        r.get("id", String.class),
        r.get("release_id", String.class),
        Operation.valueOf(r.get("operation", String.class)),
        Status.valueOf(r.get("status", String.class)),
        r.get("created_at", String.class),
        r.get("attempts", Integer.class),
        r.get("error", String.class),
        lease ? r.get("lease_token", String.class) : null);
  }

  public Mono<PublishJob> job(String id) {
    return getJob(id, false);
  }

  private Mono<PublishJob> getJob(String id, boolean lease) {
    return db.sql("SELECT * FROM publish_job WHERE id=:id")
        .bind("id", id)
        .map((r, m) -> map(r, lease))
        .one()
        .switchIfEmpty(Mono.error(Problem.missing("发布任务不存在")));
  }

  public Mono<Page<Release>> releases(int page, int size) {
    Api.bounds(page, size);
    return reconcile()
        .then(
            Mono.zip(
                    db.sql(
                            "SELECT r.id,r.created_at,CASE WHEN r.retained=0 THEN 'EXPIRED' ELSE"
                                + " j.status END status FROM release_snapshot r JOIN publish_job j"
                                + " ON j.release_id=r.id ORDER BY r.created_at DESC,r.id LIMIT"
                                + " :size OFFSET :offset")
                        .bind("size", size)
                        .bind("offset", (long) page * size)
                        .map(
                            (r, m) ->
                                new Release(
                                    r.get("id", String.class),
                                    r.get("created_at", String.class),
                                    r.get("status", String.class)))
                        .all()
                        .collectList(),
                    db.sql("SELECT COUNT(*) n FROM release_snapshot")
                        .map((r, m) -> r.get("n", Long.class))
                        .one())
                .map(t -> new Page<>(t.getT1(), page, size, t.getT2())));
  }

  /** Reconcile a worker crash after atomic current switch but before status acknowledgement. */
  public Mono<Void> reconcile() {
    return current
        .id()
        .flatMap(
            id ->
                id.map(
                        rid ->
                            db.sql(
                                    "UPDATE publish_job SET"
                                        + " status='SUCCEEDED',error=NULL,lease_expires_at=NULL"
                                        + " WHERE release_id=:rid AND status NOT IN"
                                        + " ('SUCCEEDED','FAILED')")
                                .bind("rid", rid)
                                .fetch()
                                .rowsUpdated()
                                .then())
                    .orElseGet(Mono::empty))
        .then(prune());
  }

  public Mono<PublishJob> claim() {
    long now = Instant.now().getEpochSecond();
    String token = UUID.randomUUID().toString();
    return lock()
        .then(reconcile())
        .then(
            db.sql(
                    "UPDATE publish_job SET status='FAILED',error='发布 Worker"
                        + " 多次失联，请重新发布',lease_token=NULL WHERE status IN"
                        + " ('BUILDING','READY','DEPLOYING') AND lease_expires_at<:now AND"
                        + " attempts>=3")
                .bind("now", now)
                .fetch()
                .rowsUpdated())
        .then(
            db.sql(
                    "SELECT id FROM publish_job WHERE status='QUEUED' OR (status IN"
                        + " ('BUILDING','READY','DEPLOYING') AND lease_expires_at<:now) ORDER BY"
                        + " created_at LIMIT 1")
                .bind("now", now)
                .map((r, m) -> r.get("id", String.class))
                .one())
        .flatMap(
            id ->
                db.sql(
                        "UPDATE publish_job SET"
                            + " status='BUILDING',attempts=attempts+1,lease_token=:token,lease_expires_at=:expiry,error=NULL"
                            + " WHERE id=:id")
                    .bind("token", token)
                    .bind("expiry", now + 120)
                    .bind("id", id)
                    .fetch()
                    .rowsUpdated()
                    .then(getJob(id, true)))
        .as(tx::transactional);
  }

  public Mono<Void> heartbeat(String id, String token) {
    return db.sql(
            "UPDATE publish_job SET lease_expires_at=:expiry WHERE id=:id AND lease_token=:token"
                + " AND lease_expires_at>=:now AND status IN ('BUILDING','READY','DEPLOYING')")
        .bind("expiry", Instant.now().getEpochSecond() + 120)
        .bind("id", id)
        .bind("token", token)
        .bind("now", Instant.now().getEpochSecond())
        .fetch()
        .rowsUpdated()
        .flatMap(
            n -> n == 1 ? Mono.empty() : Mono.error(Problem.conflict("LEASE_LOST", "发布租约已失效")));
  }

  public Mono<PublishJob> status(String id, StatusRequest req) {
    return lock()
        .then(getJob(id, true))
        .flatMap(
            j -> {
              if (!Objects.equals(j.leaseToken(), req.leaseToken()))
                return Mono.error(Problem.conflict("LEASE_LOST", "发布租约已失效"));
              if (j.status() == req.status()) return Mono.just(j);
              boolean valid =
                  req.status() == Status.FAILED
                          && Set.of(Status.BUILDING, Status.READY, Status.DEPLOYING)
                              .contains(j.status())
                      || j.status() == Status.BUILDING && req.status() == Status.READY
                      || j.status() == Status.READY && req.status() == Status.DEPLOYING
                      || j.status() == Status.DEPLOYING && req.status() == Status.SUCCEEDED;
              if (!valid) return Mono.error(Problem.conflict("INVALID_JOB_TRANSITION", "发布状态转换无效"));
              Mono<Void> verify =
                  req.status() == Status.READY
                      ? snapshot(j.releaseId())
                          .flatMap(
                              s -> media.verifyAvailable(MediaService.references(s.contents())))
                      : req.status() == Status.SUCCEEDED
                          ? current
                              .id()
                              .flatMap(
                                  c ->
                                      c.filter(j.releaseId()::equals).isPresent()
                                          ? Mono.empty()
                                          : Mono.error(
                                              Problem.conflict("NOT_ACTIVATED", "当前站点尚未切换到此版本")))
                          : Mono.empty();
              String safeError =
                  req.status() == Status.FAILED ? "静态构建或校验失败，请检查 Worker 本地日志并重试" : null;
              var update =
                  db.sql(
                          "UPDATE publish_job SET status=:status,error=:error WHERE id=:id AND"
                              + " lease_token=:token AND lease_expires_at>=:now")
                      .bind("status", req.status().name())
                      .bind("id", id)
                      .bind("token", req.leaseToken())
                      .bind("now", Instant.now().getEpochSecond());
              update =
                  safeError == null
                      ? update.bindNull("error", String.class)
                      : update.bind("error", safeError);
              return verify
                  .then(update.fetch().rowsUpdated())
                  .flatMap(
                      n ->
                          n == 1
                              ? audit
                                  .record("PUBLISH_" + req.status().name(), id)
                                  .then(req.status() == Status.SUCCEEDED ? prune() : Mono.empty())
                                  .then(getJob(id, true))
                              : Mono.error(Problem.conflict("LEASE_LOST", "发布租约已失效")));
            })
        .as(tx::transactional);
  }

  /**
   * Keep five completed predecessors plus the active filesystem release. Failed builds expire after
   * seven days.
   */
  public Mono<Void> prune() {
    return lock()
        .then(current.id())
        .flatMap(
            currentId ->
                db.sql(
                        "SELECT r.id FROM release_snapshot r JOIN publish_job j ON"
                            + " j.release_id=r.id WHERE r.retained=1 AND j.status='SUCCEEDED' AND"
                            + " r.id<>:current ORDER BY r.created_at DESC,r.id DESC")
                    .bind("current", currentId.orElse("empty"))
                    .map((r, m) -> r.get("id", String.class))
                    .all()
                    .skip(5)
                    .collectList()
                    .flatMap(
                        ids ->
                            db.sql(
                                    "SELECT r.id FROM release_snapshot r JOIN publish_job j ON"
                                        + " j.release_id=r.id WHERE r.retained=1 AND"
                                        + " j.status='FAILED' AND r.created_at<:cutoff AND"
                                        + " r.id<>:current")
                                .bind(
                                    "cutoff",
                                    Instant.now().minus(java.time.Duration.ofDays(7)).toString())
                                .bind("current", currentId.orElse("empty"))
                                .map((r, m) -> r.get("id", String.class))
                                .all()
                                .collectList()
                                .map(
                                    failed -> {
                                      ids.addAll(failed);
                                      return ids;
                                    })))
        .flatMapMany(Flux::fromIterable)
        .concatMap(
            id ->
                db.sql("UPDATE revision r JOIN release_entry e ON e.revision_id=r.id JOIN publish_job j ON j.release_id=e.release_id SET r.publication_protected=TRUE WHERE e.release_id=:id AND j.status='SUCCEEDED'")
                    .bind("id",id).fetch().rowsUpdated()
                    .then(db.sql("DELETE FROM release_media WHERE release_id=:id")
                    .bind("id", id)
                    .fetch()
                    .rowsUpdated())
                    .then(
                        db.sql("DELETE FROM release_entry WHERE release_id=:id")
                            .bind("id", id)
                            .fetch()
                            .rowsUpdated())
                    .then(
                        db.sql(
                                "UPDATE release_snapshot SET"
                                    + " retained=0,document=JSON_OBJECT('expired',true) WHERE"
                                    + " id=:id")
                            .bind("id", id)
                            .fetch()
                            .rowsUpdated())
                    .then(audit.record("RELEASE_EXPIRED", id)))
        .then()
        .as(tx::transactional);
  }

  public Mono<Map<String, List<String>>> retention() {
    return prune()
        .then(
            db.sql("SELECT id FROM release_snapshot WHERE retained=0 ORDER BY created_at,id")
                .map((r, m) -> r.get("id", String.class))
                .all()
                .collectList())
        .map(ids -> Map.of("expiredReleaseIds", ids));
  }
}
