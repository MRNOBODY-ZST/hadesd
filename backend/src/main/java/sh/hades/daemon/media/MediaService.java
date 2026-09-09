package sh.hades.daemon.media;

import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
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

  public MediaService(DatabaseClient db, StoragePort storage, AuditService audit) {
    this.db = db;
    this.storage = storage;
    this.audit = audit;
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

  public Mono<Void> delete(String id) {
    return get(id)
        .then(
            db.sql(
                    "SELECT (SELECT COUNT(*) FROM release_media WHERE media_id=:id)+(SELECT"
                        + " COUNT(*) FROM revision_media WHERE media_id=:id) n")
                .bind("id", id)
                .map((r, m) -> r.get("n", Long.class))
                .one())
        .flatMap(
            n -> {
              if (n > 0)
                return Mono.error(
                    Problem.conflict("MEDIA_REFERENCED", "附件仍被修订历史、当前版本或保留的回滚快照引用，不能删除"));
              return db.sql("DELETE FROM media WHERE id=:id")
                  .bind("id", id)
                  .fetch()
                  .rowsUpdated()
                  .then(storage.delete(id))
                  .then(audit.record("MEDIA_DELETED", id));
            });
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
    return verifyAvailable(refs)
        .thenMany(
            Flux.fromIterable(refs)
                .concatMap(
                    id ->
                        db.sql("INSERT INTO revision_media(revision_id,media_id) VALUES(:rid,:mid)")
                            .bind("rid", revision.id())
                            .bind("mid", id)
                            .fetch()
                            .rowsUpdated()))
        .then();
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
