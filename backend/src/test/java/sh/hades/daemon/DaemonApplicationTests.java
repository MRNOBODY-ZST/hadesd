package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.*;
import org.springframework.http.MediaType;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;
import reactor.test.StepVerifier;
import sh.hades.daemon.content.ContentService;
import sh.hades.daemon.media.*;
import sh.hades.daemon.release.ReleaseService;
import sh.hades.daemon.search.SearchPort;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class DaemonApplicationTests {
  @Container
  static MySQLContainer mysql =
      new MySQLContainer(DockerImageName.parse("mysql:8.4.11"))
          .withDatabaseName("hadesd_test")
          .withUsername("hadesd")
          .withPassword("integration-only-password")
          .withCommand("--ngram-token-size=2");

  @Container
  static GenericContainer<?> redis =
      new GenericContainer<>(DockerImageName.parse("redis:8.4.6")).withExposedPorts(6379);

  static final Path releaseRoot = temp("hadesd-releases-"), mediaRoot = temp("hadesd-media-");

  static Path temp(String prefix) {
    try {
      return Files.createTempDirectory(prefix);
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry p) {
    p.add(
        "spring.r2dbc.url",
        () ->
            "r2dbc:mysql://"
                + mysql.getHost()
                + ":"
                + mysql.getMappedPort(3306)
                + "/hadesd_test?serverZoneId=UTC");
    p.add("spring.r2dbc.username", mysql::getUsername);
    p.add("spring.r2dbc.password", mysql::getPassword);
    p.add("hades.jdbc-url", mysql::getJdbcUrl);
    p.add("spring.data.redis.host", redis::getHost);
    p.add("spring.data.redis.port", () -> redis.getMappedPort(6379));
    p.add("spring.data.redis.password", () -> "");
    p.add("hades.worker-token", () -> "test-worker-token-with-at-least-32-characters");
    p.add("hades.release-root", () -> releaseRoot.toString());
    p.add("hades.media-root", () -> mediaRoot.toString());
  }

  @LocalServerPort int port;
  @Autowired DatabaseClient db;
  @Autowired ContentService contents;
  @Autowired ReleaseService releases;
  @Autowired SearchPort search;
  @Autowired MediaService media;
  @Autowired ObjectMapper json;
  @Autowired PasswordEncoder encoder;
  WebTestClient http;

  @BeforeEach
  void client() {
    http =
        WebTestClient.bindToServer()
            .baseUrl("http://localhost:" + port)
            .responseTimeout(java.time.Duration.ofSeconds(15))
            .build();
  }

  @Test
  @Order(1)
  void sessionLoginRequiresCsrfRotatesAndLogsOut() {
    db.sql(
            "INSERT INTO admin_account(singleton,username,password_hash,created_at)"
                + " VALUES(1,'test-admin',:hash,:now)")
        .bind("hash", encoder.encode("integration-long-password"))
        .bind("now", Instant.now().toString())
        .fetch()
        .rowsUpdated()
        .block();
    db.sql("INSERT INTO blog_account(id,username,display_name,password_hash,role,created_at) SELECT UUID(),username,username,password_hash,'ADMIN',created_at FROM admin_account")
        .fetch().rowsUpdated().block();
    http.get()
        .uri("/api/v1/admin/contents")
        .exchange()
        .expectStatus()
        .isUnauthorized()
        .expectBody()
        .jsonPath("$.code")
        .isEqualTo("UNAUTHENTICATED");
    http.post()
        .uri("/api/v1/auth/login")
        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
        .bodyValue("username=test-admin&password=integration-long-password")
        .exchange()
        .expectStatus()
        .isForbidden()
        .expectBody()
        .jsonPath("$.code")
        .isEqualTo("CSRF_INVALID");
    var csrf =
        http.get()
            .uri("/api/v1/auth/csrf")
            .exchange()
            .expectStatus()
            .isOk()
            .expectBody(Map.class)
            .returnResult();
    String session = csrf.getResponseCookies().getFirst("HADESD_SESSION").getValue();
    var token = csrf.getResponseBody();
    var login =
        http.post()
            .uri("/api/v1/auth/login")
            .cookie("HADESD_SESSION", session)
            .header((String) token.get("headerName"), (String) token.get("token"))
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .bodyValue("username=test-admin&password=integration-long-password")
            .exchange()
            .expectStatus()
            .isOk()
            .returnResult(Void.class);
    String rotated = login.getResponseCookies().getFirst("HADESD_SESSION").getValue();
    assertThat(rotated).isNotEqualTo(session);
    http.get()
        .uri("/api/v1/auth/me")
        .cookie("HADESD_SESSION", rotated)
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody()
        .jsonPath("$.username")
        .isEqualTo("test-admin");
    http.post()
        .uri("/api/v1/admin/contents")
        .cookie("HADESD_SESSION", rotated)
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(input("draft", "Secret draft 中文", "classified body"))
        .exchange()
        .expectStatus()
        .isForbidden();
    var fresh =
        http.get()
            .uri("/api/v1/auth/csrf")
            .cookie("HADESD_SESSION", rotated)
            .exchange()
            .expectStatus()
            .isOk()
            .expectBody(Map.class)
            .returnResult()
            .getResponseBody();
    http.post()
        .uri("/api/v1/auth/logout")
        .cookie("HADESD_SESSION", rotated)
        .header((String) fresh.get("headerName"), (String) fresh.get("token"))
        .exchange()
        .expectStatus()
        .isNoContent();
    http.get()
        .uri("/api/v1/auth/me")
        .cookie("HADESD_SESSION", rotated)
        .exchange()
        .expectStatus()
        .isUnauthorized();
  }

  static CreateContent input(String slug, String title, String body) {
    return new CreateContent(
        ContentType.POST, title, slug, "Summary 中文", body, List.of("系统", "C++"), "zh-CN", null);
  }

  @Test
  @Order(2)
  void immutableRevisionsOptimisticLockDraftIsolationAndReleaseLifecycle() throws Exception {
    var c =
        contents
            .create(input("release-lifecycle", "系统研究 C++ 192.168.1.1", "Original 正文 needle"))
            .block();
    var original = c.latestRevision();
    var edited =
        contents
            .save(
                c.id(),
                new SaveRevision(
                    c.version(),
                    "Unpublished title",
                    original.slug(),
                    original.summary(),
                    "Private changed body",
                    original.tags(),
                    original.language(),
                    null))
            .block();
    assertThat(contents.revision(c.id(), original.id()).block().markdown())
        .isEqualTo("Original 正文 needle");
    StepVerifier.create(
            contents.save(
                c.id(),
                new SaveRevision(1, "stale", original.slug(), "", "lost", List.of(), "zh", null)))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("REVISION_CONFLICT"))
        .verify();
    assertThat(releases.active(null).block().contents()).isEmpty();
    http.get().uri("/api/v1/public/contents/" + c.id()).exchange().expectStatus().isNotFound();
    var queued =
        releases.create(new PublishRequest(Operation.PUBLISH, c.id(), original.id(), null)).block();
    StepVerifier.create(
            releases.create(new PublishRequest(Operation.PUBLISH, c.id(), original.id(), null)))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("PUBLISH_BUSY"))
        .verify();
    assertThat(releases.active(null).block().contents()).isEmpty();
    var job = releases.claim().block();
    assertThat(job.id()).isEqualTo(queued.id());
    assertThat(job.attempts()).isEqualTo(1);
    StepVerifier.create(releases.heartbeat(job.id(), "wrong"))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("LEASE_LOST"))
        .verify();
    releases.status(job.id(), new StatusRequest(job.leaseToken(), Status.READY, null)).block();
    releases.status(job.id(), new StatusRequest(job.leaseToken(), Status.DEPLOYING, null)).block();
    StepVerifier.create(
            releases.status(job.id(), new StatusRequest(job.leaseToken(), Status.SUCCEEDED, null)))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("NOT_ACTIVATED"))
        .verify();
    activate(job.releaseId());
    // Deliberately omit success acknowledgement: current manifest repairs the database record.
    releases.reconcile().block();
    assertThat(releases.job(job.id()).block().status()).isEqualTo(Status.SUCCEEDED);
    var live = releases.active(null).block();
    assertThat(live.contents().getFirst().revisionId()).isEqualTo(original.id());
    assertThat(live.contents().getFirst().title()).isEqualTo(original.title());
    for (String q : List.of("系", "系统", "C++", "192.168.1.1", "NEEDLE", "正文"))
      assertThat(search.search(live, q, 0, 20).block().items()).as(q).hasSize(1);
    assertThat(search.search(live, "Private", 0, 20).block().items()).isEmpty();
    assertThat(search.search(live, "' OR 1=1 --", 0, 20).block().items()).isEmpty();
    assertThat(search.search(live, "", 0, 20).block().items()).isEmpty();
    var duplicate = contents.create(input(original.slug(), "Duplicate route", "body")).block();
    StepVerifier.create(
            releases.create(
                new PublishRequest(
                    Operation.PUBLISH, duplicate.id(), duplicate.latestRevision().id(), null)))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("SLUG_CONFLICT"))
        .verify();
    var withdrawal =
        releases.create(new PublishRequest(Operation.WITHDRAW, c.id(), null, null)).block();
    deployClaimed();
    assertThat(releases.active(null).block().contents()).isEmpty();
    http.get().uri("/api/v1/public/contents/" + c.id()).exchange().expectStatus().isNotFound();
    http.get()
        .uri("/api/v1/public/search?q=needle&releaseId=" + live.releaseId())
        .exchange()
        .expectStatus()
        .isEqualTo(409)
        .expectBody()
        .jsonPath("$.code")
        .isEqualTo("RELEASE_CHANGED");
    http.get()
        .uri("/api/v1/public/site?releaseId=" + live.releaseId())
        .exchange()
        .expectStatus()
        .isEqualTo(409)
        .expectBody()
        .jsonPath("$.code")
        .isEqualTo("RELEASE_CHANGED");
    releases.create(new PublishRequest(Operation.ROLLBACK, null, null, live.releaseId())).block();
    deployClaimed();
    assertThat(releases.active(null).block().contents()).hasSize(1);
  }

  @Test
  @Order(3)
  void workerLeaseExpiryRecoveryAndCredentialBoundary() {
    http.post().uri("/api/v1/internal/jobs/claim").exchange().expectStatus().isUnauthorized();
    http.get().uri("/api/v1/internal/snapshot/unknown").exchange().expectStatus().isUnauthorized();
    var c = contents.create(input("lease-recovery", "Lease", "body")).block();
    releases
        .create(new PublishRequest(Operation.PUBLISH, c.id(), c.latestRevision().id(), null))
        .block();
    var first = releases.claim().block();
    db.sql("UPDATE publish_job SET lease_expires_at=0 WHERE id=:id")
        .bind("id", first.id())
        .fetch()
        .rowsUpdated()
        .block();
    var second = releases.claim().block();
    assertThat(second.id()).isEqualTo(first.id());
    assertThat(second.attempts()).isEqualTo(2);
    assertThat(second.leaseToken()).isNotEqualTo(first.leaseToken());
    StepVerifier.create(
            releases.status(first.id(), new StatusRequest(first.leaseToken(), Status.READY, null)))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("LEASE_LOST"))
        .verify();
    releases
        .status(
            second.id(),
            new StatusRequest(
                second.leaseToken(), Status.FAILED, "must not leak /private/key token=secret"))
        .block();
    var failed =
        releases
            .status(second.id(), new StatusRequest(second.leaseToken(), Status.FAILED, "duplicate"))
            .block();
    assertThat(failed.error()).doesNotContain("secret", "/private");
  }

  record Session(String cookie, String token, String header) {}

  Session login() {
    var csrf =
        http.get()
            .uri("/api/v1/auth/csrf")
            .exchange()
            .expectStatus()
            .isOk()
            .expectBody(Map.class)
            .returnResult();
    String cookie = csrf.getResponseCookies().getFirst("HADESD_SESSION").getValue();
    var data = csrf.getResponseBody();
    var login =
        http.post()
            .uri("/api/v1/auth/login")
            .cookie("HADESD_SESSION", cookie)
            .header((String) data.get("headerName"), (String) data.get("token"))
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .bodyValue("username=test-admin&password=integration-long-password")
            .exchange()
            .expectStatus()
            .isOk()
            .returnResult(Void.class);
    cookie = login.getResponseCookies().getFirst("HADESD_SESSION").getValue();
    data =
        http.get()
            .uri("/api/v1/auth/csrf")
            .cookie("HADESD_SESSION", cookie)
            .exchange()
            .expectStatus()
            .isOk()
            .expectBody(Map.class)
            .returnResult()
            .getResponseBody();
    return new Session(cookie, (String) data.get("token"), (String) data.get("headerName"));
  }

  @Test
  @Order(4)
  void realMultipartUploadIsPrivateUntilReferencedAndHistoricalRevisionsProtectIt()
      throws Exception {
    var session = login();
    byte[] png =
        Base64.getDecoder()
            .decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9p8AAAAASUVORK5CYII=");
    var parts = new org.springframework.http.client.MultipartBodyBuilder();
    parts
        .part(
            "file",
            new org.springframework.core.io.ByteArrayResource(png) {
              @Override
              public String getFilename() {
                return "test.png";
              }
            })
        .contentType(MediaType.IMAGE_PNG);
    var uploaded =
        http.post()
            .uri("/api/v1/admin/media")
            .cookie("HADESD_SESSION", session.cookie())
            .header(session.header(), session.token())
            .body(
                org.springframework.web.reactive.function.BodyInserters.fromMultipartData(
                    parts.build()))
            .exchange()
            .expectStatus()
            .isCreated()
            .expectBody(Media.class)
            .returnResult()
            .getResponseBody();
    assertThat(uploaded.size()).isEqualTo(png.length);
    String checksum =
        db.sql("SELECT sha256 FROM media WHERE id=:id")
            .bind("id", uploaded.id())
            .map((r, m) -> r.get("sha256", String.class))
            .one()
            .block();
    assertThat(checksum)
        .isEqualTo(
            java.util.HexFormat.of()
                .formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(png)));
    http.get().uri("/api/v1/public/media/" + uploaded.id()).exchange().expectStatus().isNotFound();
    http.get()
        .uri("/api/v1/admin/media/" + uploaded.id() + "/content")
        .exchange()
        .expectStatus()
        .isUnauthorized();
    http.get()
        .uri("/api/v1/admin/media/" + uploaded.id() + "/content")
        .cookie("HADESD_SESSION", session.cookie())
        .exchange()
        .expectStatus()
        .isOk()
        .expectBody(byte[].class)
        .isEqualTo(png);
    var bad = new org.springframework.http.client.MultipartBodyBuilder();
    bad.part(
            "file",
            new org.springframework.core.io.ByteArrayResource(
                "<svg onload='alert(1)'/>".getBytes()) {
              @Override
              public String getFilename() {
                return "pretend.png";
              }
            })
        .contentType(MediaType.IMAGE_PNG);
    http.post()
        .uri("/api/v1/admin/media")
        .cookie("HADESD_SESSION", session.cookie())
        .header(session.header(), session.token())
        .body(
            org.springframework.web.reactive.function.BodyInserters.fromMultipartData(bad.build()))
        .exchange()
        .expectStatus()
        .isEqualTo(415)
        .expectBody()
        .jsonPath("$.code")
        .isEqualTo("UNSUPPORTED_MEDIA");
    var c =
        contents
            .create(
                new CreateContent(
                    ContentType.POST,
                    "Image post",
                    "image-post",
                    "summary",
                    "![test](/api/v1/public/media/" + uploaded.id() + ")",
                    List.of(),
                    "zh-CN",
                    uploaded.id()))
            .block();
    releases
        .create(new PublishRequest(Operation.PUBLISH, c.id(), c.latestRevision().id(), null))
        .block();
    deployClaimed();
    http.get()
        .uri("/api/v1/public/media/" + uploaded.id())
        .exchange()
        .expectStatus()
        .isOk()
        .expectHeader()
        .valueEquals("X-Content-Type-Options", "nosniff")
        .expectBody(byte[].class)
        .isEqualTo(png);
    StepVerifier.create(media.delete(uploaded.id()))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("MEDIA_REFERENCED"))
        .verify();
    releases.create(new PublishRequest(Operation.WITHDRAW, c.id(), null, null)).block();
    deployClaimed();
    http.get().uri("/api/v1/public/media/" + uploaded.id()).exchange().expectStatus().isNotFound();
    StepVerifier.create(media.delete(uploaded.id()))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).code).isEqualTo("MEDIA_REFERENCED"))
        .verify();
  }

  @Test
  @Order(5)
  void retentionKeepsCurrentAndFiveCompletedPredecessors() throws Exception {
    String first = releases.active(null).block().releaseId();
    for (int i = 0; i < 7; i++) {
      releases.create(new PublishRequest(Operation.SETTINGS, null, null, null)).block();
      deployClaimed();
    }
    var expired = releases.retention().block().get("expiredReleaseIds");
    assertThat(expired).contains(first);
    assertThat(expired).doesNotContain(releases.active(null).block().releaseId());
    StepVerifier.create(releases.snapshot(first))
        .expectErrorSatisfies(e -> assertThat(((Problem) e).status).isEqualTo(404))
        .verify();
    Long retained =
        db.sql(
                "SELECT COUNT(*) n FROM release_snapshot r JOIN publish_job j ON j.release_id=r.id"
                    + " WHERE r.retained=1 AND j.status='SUCCEEDED'")
            .map((r, m) -> r.get("n", Long.class))
            .one()
            .block();
    assertThat(retained).isEqualTo(6L);
    Long expiredMediaRefs =
        db.sql(
                "SELECT COUNT(*) n FROM release_media rm JOIN release_snapshot r ON"
                    + " rm.release_id=r.id WHERE r.retained=0")
            .map((r, m) -> r.get("n", Long.class))
            .one()
            .block();
    assertThat(expiredMediaRefs).isZero();
  }

  @Test
  @Order(6)
  void redisOutageFailsClosedForAdminAndPublicSearchFallsBack() {
    var session = login();
    redis.getDockerClient().pauseContainerCmd(redis.getContainerId()).exec();
    try {

      http.get()
          .uri("/api/v1/auth/me")
          .cookie("HADESD_SESSION", session.cookie())
          .exchange()
          .expectStatus()
          .isEqualTo(503)
          .expectBody()
          .jsonPath("$.code")
          .isEqualTo("SERVICE_UNAVAILABLE");
      http.get().uri("/api/v1/public/contents").exchange().expectStatus().isOk();
      http.get()
          .uri("/api/v1/public/search?q=needle")
          .exchange()
          .expectStatus()
          .isOk()
          .expectBody()
          .jsonPath("$.total")
          .isEqualTo(1);
    } finally {
      redis.getDockerClient().unpauseContainerCmd(redis.getContainerId()).exec();
    }
  }

  Media uploadAdmin(Session session,String name) {
    byte[] png=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9p8AAAAASUVORK5CYII=");
    var parts=new org.springframework.http.client.MultipartBodyBuilder();
    parts.part("file",new org.springframework.core.io.ByteArrayResource(png) {
      @Override public String getFilename() { return name; }
    }).contentType(MediaType.IMAGE_PNG);
    return http.post().uri("/api/v1/admin/media").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .body(org.springframework.web.reactive.function.BodyInserters.fromMultipartData(parts.build())).exchange().expectStatus().isCreated()
      .expectBody(Media.class).returnResult().getResponseBody();
  }

  SaveRevision replaceBody(Content c,String body) {
    var r=c.latestRevision();
    return new SaveRevision(c.version(),r.title(),r.slug(),r.summary(),body,r.tags(),r.language(),null);
  }

  @Test @Order(7)
  void recycleBinIsVersionedReversibleAndNeverSilentlyChangesThePublicSite() throws Exception {
    var session=login(); var c=contents.create(input("trash-lifecycle","MixedCase literal%_trash","Immutable first draft")).block();
    assertThat(contents.list(0,20,"mixedcase","all",false).block().items()).extracting(Content::id).containsExactly(c.id());
    assertThat(contents.list(0,20,"TRASH-LIFECYCLE","POST",false).block().items()).extracting(Content::id).containsExactly(c.id());
    http.get().uri("/api/v1/admin/contents/"+c.id()).exchange().expectStatus().isUnauthorized();
    http.delete().uri("/api/v1/admin/contents/"+c.id()+"?version=1").exchange().expectStatus().isForbidden();
    http.delete().uri("/api/v1/admin/contents/"+c.id()+"?version=1").cookie("HADESD_SESSION",session.cookie()).exchange().expectStatus().isForbidden();
    http.delete().uri("/api/v1/admin/contents/"+c.id()+"?version=42").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .exchange().expectStatus().isEqualTo(409).expectBody().jsonPath("$.code").isEqualTo("REVISION_CONFLICT");
    http.delete().uri("/api/v1/admin/contents/"+c.id()+"?version=1").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .exchange().expectStatus().isNoContent();
    var deleted=contents.get(c.id()).block(); assertThat(deleted.deletedAt()).isNotBlank(); assertThat(deleted.version()).isEqualTo(2);
    assertThat(contents.list(0,20,"literal%_trash","POST",false).block().items()).isEmpty();
    assertThat(contents.list(0,20,"literal%_trash","POST",true).block().items()).extracting(Content::id).containsExactly(c.id());
    assertThat(contents.list(0,20,"MIXEDcase","POST",true).block().items()).extracting(Content::id).containsExactly(c.id());
    assertThat(contents.revision(c.id(),c.latestRevision().id()).block().markdown()).isEqualTo("Immutable first draft");
    StepVerifier.create(contents.save(c.id(),replaceBody(deleted,"changed")))
      .expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("CONTENT_DELETED")).verify();
    StepVerifier.create(releases.create(new PublishRequest(Operation.PUBLISH,c.id(),c.latestRevision().id(),null)))
      .expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("CONTENT_DELETED")).verify();
    http.post().uri("/api/v1/admin/contents/"+c.id()+"/restore").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .bodyValue(Map.of("version",1)).exchange().expectStatus().isEqualTo(409);
    var restored=http.post().uri("/api/v1/admin/contents/"+c.id()+"/restore").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .bodyValue(Map.of("version",2)).exchange().expectStatus().isOk().expectBody(Content.class).returnResult().getResponseBody();
    assertThat(restored.deletedAt()).isNull(); assertThat(restored.version()).isEqualTo(3);
    assertThat(releases.active(null).block().contents()).noneMatch(value->value.id().equals(c.id()));
    releases.create(new PublishRequest(Operation.PUBLISH,c.id(),c.latestRevision().id(),null)).block();
    StepVerifier.create(contents.delete(c.id(),3)).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("PUBLISH_BUSY")).verify();
    deployClaimed(); String published=releases.active(null).block().releaseId();
    StepVerifier.create(contents.delete(c.id(),3)).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("CONTENT_PUBLISHED")).verify();
    releases.create(new PublishRequest(Operation.WITHDRAW,c.id(),null,null)).block(); deployClaimed(); contents.delete(c.id(),3).block();
    assertThat(releases.snapshot(published).block().contents()).anyMatch(value->value.id().equals(c.id()));
    StepVerifier.create(releases.create(new PublishRequest(Operation.ROLLBACK,null,null,published)))
      .expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("CONTENT_DELETED")).verify();
    contents.restore(c.id(),4).block(); releases.create(new PublishRequest(Operation.ROLLBACK,null,null,published)).block(); deployClaimed();
    assertThat(releases.active(null).block().contents()).anyMatch(value->value.id().equals(c.id()));
  }

  @Test @Order(8)
  void mediaSearchReferencesAndBatchDeletionReturnIndependentOutcomes() {
    var session=login(); String prefix="batch-"+UUID.randomUUID();
    var unused=uploadAdmin(session,prefix+"%_unused.png"); var used=uploadAdmin(session,prefix+"-used.png"); var history=uploadAdmin(session,prefix+"-history.png");
    var draft=contents.create(input("batch-draft","Protected draft","![image](/api/v1/public/media/"+used.id()+")")).block();
    var old=contents.create(input("batch-history","Unpublished old draft","![image](/api/v1/public/media/"+history.id()+")")).block();
    contents.save(old.id(),replaceBody(old,"No image in latest draft")).block();
    var listed=media.listAdmin(0,1,prefix,"image","all").block(); assertThat(listed.total()).isEqualTo(3); assertThat(listed.items()).hasSize(1);
    assertThat(media.listAdmin(1,1,prefix,"image","all").block().items().getFirst().id()).isNotEqualTo(listed.items().getFirst().id());
    assertThat(media.listAdmin(0,20,"%_unused","image","unused").block().items()).extracting(AdminMedia::id).containsExactly(unused.id());
    assertThat(media.listAdmin(0,20,prefix,"text","all").block().total()).isZero();
    assertThat(media.listAdmin(0,20,prefix,"image","used").block().total()).isEqualTo(2);
    var historical=media.listAdmin(0,20,history.id(),"all","all").block().items().getFirst();
    assertThat(historical.canDelete()).isFalse(); assertThat(historical.canDeleteHistory()).isTrue();
    http.get().uri("/api/v1/admin/media/"+used.id()+"/references").cookie("HADESD_SESSION",session.cookie()).exchange().expectStatus().isOk()
      .expectBody().jsonPath("$.items[0].kind").isEqualTo("DRAFT").jsonPath("$.items[0].contentId").isEqualTo(draft.id()).jsonPath("$.items[0].protected").isEqualTo(true);
    http.get().uri("/api/v1/admin/media?type=invalid").cookie("HADESD_SESSION",session.cookie()).exchange().expectStatus().isBadRequest();
    http.post().uri("/api/v1/admin/media/batch-delete").cookie("HADESD_SESSION",session.cookie()).bodyValue(Map.of("ids",List.of(unused.id()))).exchange().expectStatus().isForbidden();
    var result=http.post().uri("/api/v1/admin/media/batch-delete").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .bodyValue(new MediaBatchDelete(List.of(unused.id(),used.id(),history.id(),UUID.randomUUID().toString()),false)).exchange().expectStatus().isOk()
      .expectBody(MediaBatchDeleteResult.class).returnResult().getResponseBody();
    assertThat(result.results()).extracting(MediaDeleteResult::status).containsExactly("DELETED","REFERENCED","REFERENCED","NOT_FOUND");
    assertThat(result.results().get(1).message()).contains("Protected draft");
    http.get().uri("/api/v1/admin/media/"+unused.id()+"/content").cookie("HADESD_SESSION",session.cookie()).exchange().expectStatus().isNotFound();
    var cleanup=media.batchDelete(new MediaBatchDelete(List.of(history.id(),used.id()),true)).block();
    assertThat(cleanup.results()).extracting(MediaDeleteResult::status).containsExactly("DELETED","REFERENCED");
    assertThat(contents.revision(old.id(),old.latestRevision().id()).block().markdown()).contains(history.id());
    StepVerifier.create(contents.purge(draft.id(),draft.version())).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("CONTENT_NOT_DELETED")).verify();
    contents.delete(draft.id(),draft.version()).block(); assertThat(media.references(used.id(),0,20).block().items().getFirst().deleted()).isTrue();
    assertThat(media.batchDelete(new MediaBatchDelete(List.of(used.id()),true)).block().results().getFirst().status()).isEqualTo("REFERENCED");
    http.post().uri("/api/v1/admin/media/batch-delete").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .bodyValue(Map.of("ids",List.of(used.id(),used.id()))).exchange().expectStatus().isBadRequest();
    http.delete().uri("/api/v1/admin/contents/"+draft.id()+"/purge?version=1").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .exchange().expectStatus().isEqualTo(409);
    http.delete().uri("/api/v1/admin/contents/"+draft.id()+"/purge?version=2").cookie("HADESD_SESSION",session.cookie()).header(session.header(),session.token())
      .exchange().expectStatus().isNoContent();
    StepVerifier.create(contents.get(draft.id())).expectErrorSatisfies(e->assertThat(((Problem)e).status).isEqualTo(404)).verify();
    assertThat(media.get(used.id()).block()).isNotNull();
    assertThat(media.listAdmin(0,20,used.id(),"all","unused").block().items()).hasSize(1);
    assertThat(media.batchDelete(new MediaBatchDelete(List.of(used.id()),false)).block().results().getFirst().status()).isEqualTo("DELETED");
  }

  @Test @Order(9)
  void publishedRevisionRemainsProtectedAfterItsRollbackSnapshotExpires() throws Exception {
    var file=uploadAdmin(login(),"published-history.png");
    var c=contents.create(input("published-history","Published history","![image](/api/v1/public/media/"+file.id()+")")).block();
    releases.create(new PublishRequest(Operation.PUBLISH,c.id(),c.latestRevision().id(),null)).block(); deployClaimed(); String oldRelease=releases.active(null).block().releaseId();
    releases.create(new PublishRequest(Operation.WITHDRAW,c.id(),null,null)).block(); deployClaimed(); contents.save(c.id(),replaceBody(c,"No longer uses image")).block();
    for(int i=0;i<7;i++) { releases.create(new PublishRequest(Operation.SETTINGS,null,null,null)).block(); deployClaimed(); }
    assertThat(releases.retention().block().get("expiredReleaseIds")).contains(oldRelease);
    assertThat(media.listAdmin(0,20,file.id(),"all","all").block().items().getFirst().canDeleteHistory()).isFalse();
    assertThat(media.references(file.id(),0,20).block().items()).allMatch(ref->ref.kind().equals("HISTORY")&&ref.protectedReference());
    assertThat(media.batchDelete(new MediaBatchDelete(List.of(file.id()),true)).block().results().getFirst().status()).isEqualTo("REFERENCED");
    contents.delete(c.id(),2).block();
    StepVerifier.create(contents.purge(c.id(),3)).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("CONTENT_HISTORY_PROTECTED")).verify();
  }

  @Autowired StoragePort actualStorage;
  @Autowired org.springframework.transaction.reactive.TransactionalOperator transactions;
  @Autowired sh.hades.daemon.audit.AuditService audit;
  @Autowired sh.hades.daemon.release.CurrentRelease currentRelease;

  @Test @Order(10)
  void committedMediaDeletionSurvivesObjectStoreFailureAndRetriesFromQueue() {
    var file=uploadAdmin(login(),"retry-deletion.png");
    StoragePort unavailable=new StoragePort() {
      public reactor.core.publisher.Mono<Void> put(String key,byte[] bytes,String mime) { return actualStorage.put(key,bytes,mime); }
      public reactor.core.publisher.Mono<byte[]> read(String key) { return actualStorage.read(key); }
      public reactor.core.publisher.Mono<Boolean> exists(String key) { return actualStorage.exists(key); }
      public reactor.core.publisher.Mono<Void> delete(String key) { return reactor.core.publisher.Mono.error(new IllegalStateException("temporary outage")); }
    };
    var service=new MediaService(db,unavailable,audit,transactions,currentRelease);
    StepVerifier.create(service.delete(file.id())).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("MEDIA_DELETE_FAILED")).verify();
    assertThat(actualStorage.exists(file.id()).block()).isTrue();
    assertThat(db.sql("SELECT COUNT(*) n FROM media_deletion_queue WHERE media_id=:id").bind("id",file.id()).map((r,m)->r.get("n",Long.class)).one().block()).isEqualTo(1);
    StepVerifier.create(media.get(file.id())).expectErrorSatisfies(e->assertThat(((Problem)e).status).isEqualTo(404)).verify();
    media.retryDeletes().block(); assertThat(actualStorage.exists(file.id()).block()).isFalse();
    assertThat(db.sql("SELECT COUNT(*) n FROM media_deletion_queue WHERE media_id=:id").bind("id",file.id()).map((r,m)->r.get("n",Long.class)).one().block()).isZero();
  }

  void deployClaimed() throws Exception {
    var j = releases.claim().block();
    releases.status(j.id(), new StatusRequest(j.leaseToken(), Status.READY, null)).block();
    releases.status(j.id(), new StatusRequest(j.leaseToken(), Status.DEPLOYING, null)).block();
    activate(j.releaseId());
    releases.status(j.id(), new StatusRequest(j.leaseToken(), Status.SUCCEEDED, null)).block();
  }

  void activate(String id) throws Exception {
    Path dir = releaseRoot.resolve("releases").resolve(id);
    Files.createDirectories(dir);
    Files.writeString(
        dir.resolve("manifest.json"),
        json.writeValueAsString(Map.of("releaseId", id, "createdAt", Instant.now().toString())));
    Path link = releaseRoot.resolve("next");
    Files.deleteIfExists(link);
    Files.createSymbolicLink(link, Path.of("releases", id));
    Files.move(
        link,
        releaseRoot.resolve("current"),
        StandardCopyOption.ATOMIC_MOVE,
        StandardCopyOption.REPLACE_EXISTING);
  }
}
