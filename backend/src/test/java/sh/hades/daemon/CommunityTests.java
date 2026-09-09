package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.http.*;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.reactive.function.BodyInserters;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import sh.hades.daemon.community.*;
import sh.hades.daemon.community.CommunityApi.*;
import sh.hades.daemon.content.ContentService;
import sh.hades.daemon.release.ReleaseService;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

@Testcontainers
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class CommunityTests {
  @Container static MySQLContainer mysql=new MySQLContainer(DockerImageName.parse("mysql:8.4.11"))
      .withDatabaseName("community_test").withUsername("hadesd").withPassword("integration-only-password").withCommand("--ngram-token-size=2");
  @Container static GenericContainer<?> redis=new GenericContainer<>(DockerImageName.parse("redis:8.4.6")).withExposedPorts(6379);
  static final Path releaseRoot=temp("community-releases-"),mediaRoot=temp("community-media-");
  static Path temp(String prefix) { try { return Files.createTempDirectory(prefix); } catch(Exception e) { throw new RuntimeException(e); } }
  @DynamicPropertySource static void properties(DynamicPropertyRegistry p) {
    p.add("spring.r2dbc.url",()->"r2dbc:mysql://"+mysql.getHost()+":"+mysql.getMappedPort(3306)+"/community_test?serverZoneId=UTC");
    p.add("spring.r2dbc.username",mysql::getUsername); p.add("spring.r2dbc.password",mysql::getPassword);
    p.add("hades.jdbc-url",mysql::getJdbcUrl); p.add("spring.data.redis.host",redis::getHost);
    p.add("spring.data.redis.port",()->redis.getMappedPort(6379)); p.add("spring.data.redis.password",()->"");
    p.add("hades.worker-token",()->"test-worker-token-with-at-least-32-characters");
    p.add("hades.release-root",()->releaseRoot.toString()); p.add("hades.media-root",()->mediaRoot.toString());
  }
  @LocalServerPort int port;
  @Autowired DatabaseClient db;
  @Autowired AccountService accounts;
  @Autowired CommentService comments;
  @Autowired UserFileService files;
  @Autowired ContentService contents;
  @Autowired ReleaseService releases;
  @Autowired PasswordEncoder encoder;
  @Autowired ObjectMapper json;
  @Autowired ReactiveStringRedisTemplate counters;
  WebTestClient http;
  static final String PASSWORD="integration-reader-password";
  record Session(String cookie,String header,String token) {}

  @BeforeEach void administrator() {
    if (db.sql("SELECT COUNT(*) n FROM admin_account").map((r,m)->r.get("n",Long.class)).one().block() > 0) return;
    db.sql("INSERT INTO admin_account(singleton,username,password_hash,created_at) VALUES(1,'test-admin',:hash,:now)")
        .bind("hash",encoder.encode(PASSWORD)).bind("now",Instant.now().toString()).fetch().rowsUpdated().block();
    db.sql("INSERT INTO blog_account(id,username,display_name,password_hash,role,created_at) SELECT UUID(),username,username,password_hash,'ADMIN',created_at FROM admin_account").fetch().rowsUpdated().block();
  }
  @BeforeEach void client() {
    http=WebTestClient.bindToServer().baseUrl("http://localhost:"+port).responseTimeout(java.time.Duration.ofSeconds(20)).build();
    counters.keys("hadesd:rate:*").flatMap(counters::delete).then().block();
  }
  Session csrf(String cookie) {
    var request=http.get().uri("/api/v1/auth/csrf");
    if(cookie!=null) request.cookie("HADESD_SESSION",cookie);
    var response=request.exchange().expectStatus().isOk().expectBody(Map.class).returnResult();
    var data=response.getResponseBody();
    if(cookie==null) cookie=response.getResponseCookies().getFirst("HADESD_SESSION").getValue();
    return new Session(cookie,(String)data.get("headerName"),(String)data.get("token"));
  }
  Session login(String username,String password) {
    var s=csrf(null);
    var result=http.post().uri("/api/v1/auth/login").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token())
        .contentType(MediaType.APPLICATION_FORM_URLENCODED).body(BodyInserters.fromFormData("username",username).with("password",password))
        .exchange().expectStatus().isOk().returnResult(Void.class);
    String cookie=result.getResponseCookies().getFirst("HADESD_SESSION").getValue();
    assertThat(cookie).isNotEqualTo(s.cookie());
    return csrf(cookie);
  }
  User reader() { String name="reader"+UUID.randomUUID().toString().substring(0,8); return accounts.register(new Register(name,"读者 "+name,PASSWORD)).block(); }
  Content content() { return contents.create(new CreateContent(ContentType.POST,"Public post","post-"+UUID.randomUUID(),"Summary","Published body",List.of(),"zh-CN",null)).block(); }
  Content publish() throws Exception {
    var content=content();
    releases.create(new PublishRequest(Operation.PUBLISH,content.id(),content.latestRevision().id(),null)).block(); deploy(); return content;
  }
  void deploy() throws Exception {
    var job=releases.claim().block();
    releases.status(job.id(),new StatusRequest(job.leaseToken(),Status.READY,null)).block();
    releases.status(job.id(),new StatusRequest(job.leaseToken(),Status.DEPLOYING,null)).block();
    var dir=releaseRoot.resolve("releases").resolve(job.releaseId()); Files.createDirectories(dir);
    Files.writeString(dir.resolve("manifest.json"),json.writeValueAsString(Map.of("releaseId",job.releaseId(),"createdAt",Instant.now().toString())));
    var next=releaseRoot.resolve("next"); Files.deleteIfExists(next); Files.createSymbolicLink(next,Path.of("releases",job.releaseId()));
    Files.move(next,releaseRoot.resolve("current"),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
    releases.status(job.id(),new StatusRequest(job.leaseToken(),Status.SUCCEEDED,null)).block();
  }
  Media upload(Session s,String name,byte[] bytes,String endpoint) {
    var parts=new MultipartBodyBuilder(); parts.part("file",new ByteArrayResource(bytes){@Override public String getFilename(){return name;}});
    return http.post().uri(endpoint).cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token())
        .body(BodyInserters.fromMultipartData(parts.build())).exchange().expectStatus().isCreated().expectBody(Media.class).returnResult().getResponseBody();
  }

  @Test void registrationIsCsrfProtectedUniqueAndDoesNotAuthenticate() {
    http.get().uri("/api/v1/auth/session").exchange().expectStatus().isOk().expectHeader().valueEquals("Cache-Control","no-store").expectBody().jsonPath("$.user").isEmpty();
    http.get().uri("/api/v1/auth/me").exchange().expectStatus().isUnauthorized();
    var input=new Register("registered-reader","初次读者",PASSWORD);
    http.post().uri("/api/v1/auth/register").bodyValue(input).exchange().expectStatus().isForbidden();
    var s=csrf(null);
    http.post().uri("/api/v1/auth/register").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(input)
        .exchange().expectStatus().isCreated().expectBody().jsonPath("$.role").isEqualTo("USER").jsonPath("$.id").isNotEmpty().jsonPath("$.password").doesNotExist();
    http.get().uri("/api/v1/auth/me").cookie("HADESD_SESSION",s.cookie()).exchange().expectStatus().isUnauthorized();
    http.post().uri("/api/v1/auth/register").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(input)
        .exchange().expectStatus().isEqualTo(409).expectBody().jsonPath("$.code").isEqualTo("USERNAME_TAKEN");
    StepVerifier.create(accounts.register(new Register("test-admin","fake",PASSWORD))).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("RESERVED_USERNAME")).verify();
    StepVerifier.create(accounts.register(new Register("safe-reader","管理员",PASSWORD))).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("RESERVED_USERNAME")).verify();
    StepVerifier.create(accounts.register(new Register("long-password","Too long","密".repeat(25)))).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("INVALID_PASSWORD")).verify();
    var duplicate=new Register("concurrent-reader","Concurrent",PASSWORD);
    var outcomes=Mono.zip(accounts.register(duplicate).map(x->"created").onErrorResume(Problem.class,e->Mono.just(e.code)),accounts.register(duplicate).map(x->"created").onErrorResume(Problem.class,e->Mono.just(e.code))).block();
    assertThat(List.of(outcomes.getT1(),outcomes.getT2())).containsExactlyInAnyOrder("created","USERNAME_TAKEN");
  }

  @Test void userSessionProfilePasswordAndAdminBoundaries() {
    var reader=reader(); var s=login(reader.username(),PASSWORD);
    http.get().uri("/api/v1/auth/session").cookie("HADESD_SESSION",s.cookie()).exchange().expectStatus().isOk().expectBody().jsonPath("$.user.id").isEqualTo(reader.id()).jsonPath("$.user.role").isEqualTo("USER");
    for(String path:List.of("/api/v1/admin/contents","/api/v1/admin/comments","/api/v1/admin/media","/api/v1/admin/releases"))
      http.get().uri(path).cookie("HADESD_SESSION",s.cookie()).exchange().expectStatus().isForbidden();
    http.put().uri("/api/v1/account/profile").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(new Profile("新昵称"))
        .exchange().expectStatus().isOk().expectBody().jsonPath("$.displayName").isEqualTo("新昵称").jsonPath("$.username").isEqualTo(reader.username());
    http.post().uri("/api/v1/account/password").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(new Password("wrong-password","changed-password-2026"))
        .exchange().expectStatus().isBadRequest().expectBody().jsonPath("$.code").isEqualTo("CURRENT_PASSWORD_INVALID");
    http.post().uri("/api/v1/account/password").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(new Password(PASSWORD,"changed-password-2026"))
        .exchange().expectStatus().isNoContent();
    http.get().uri("/api/v1/auth/me").cookie("HADESD_SESSION",s.cookie()).exchange().expectStatus().isUnauthorized();
    var updated=login(reader.username(),"changed-password-2026");
    http.get().uri("/api/v1/auth/me").cookie("HADESD_SESSION",updated.cookie()).exchange().expectStatus().isOk().expectBody().jsonPath("$.displayName").isEqualTo("新昵称");
    var admin=login("test-admin",PASSWORD);
    http.get().uri("/api/v1/auth/me").cookie("HADESD_SESSION",admin.cookie()).exchange().expectStatus().isOk().expectBody().jsonPath("$.role").isEqualTo("ADMIN");
  }

  @Test void commentsRepliesFilesAndOwnershipAreEnforcedOverHttp() throws Exception {
    var published=publish(); var draft=content(); var first=reader(); var second=reader();
    var a=login(first.username(),PASSWORD); var b=login(second.username(),PASSWORD);
    var upload=upload(a,"阅读说明.txt","仅本人上传 UTF-8".getBytes(java.nio.charset.StandardCharsets.UTF_8),"/api/v1/account/files");
    http.get().uri("/api/v1/public/comment-files/"+upload.id()).exchange().expectStatus().isNotFound();
    http.get().uri("/api/v1/account/files/"+upload.id()+"/content").cookie("HADESD_SESSION",b.cookie()).exchange().expectStatus().isNotFound();
    http.delete().uri("/api/v1/account/files/"+upload.id()).cookie("HADESD_SESSION",b.cookie()).header(b.header(),b.token()).exchange().expectStatus().isNotFound();
    http.get().uri("/api/v1/public/contents/"+draft.id()+"/comments").exchange().expectStatus().isNotFound();
    var anonymous=csrf(null);
    http.post().uri("/api/v1/public/contents/"+published.id()+"/comments").cookie("HADESD_SESSION",anonymous.cookie()).header(anonymous.header(),anonymous.token()).bodyValue(new CreateComment("anonymous",null,null)).exchange().expectStatus().isUnauthorized();
    http.post().uri("/api/v1/public/contents/"+draft.id()+"/comments").cookie("HADESD_SESSION",a.cookie()).header(a.header(),a.token()).bodyValue(new CreateComment("draft",null,null)).exchange().expectStatus().isNotFound();
    http.post().uri("/api/v1/public/contents/"+published.id()+"/comments").cookie("HADESD_SESSION",b.cookie()).header(b.header(),b.token()).bodyValue(new CreateComment("stolen",null,List.of(upload.id()))).exchange().expectStatus().isNotFound();
    var comment=http.post().uri("/api/v1/public/contents/"+published.id()+"/comments").cookie("HADESD_SESSION",a.cookie()).header(a.header(),a.token()).bodyValue(new CreateComment("第一条评论",null,List.of(upload.id())))
        .exchange().expectStatus().isCreated().expectBody(Comment.class).returnResult().getResponseBody();
    assertThat(comment.author().id()).isEqualTo(first.id()); assertThat(comment.attachments()).hasSize(1);
    http.get().uri("/api/v1/public/comment-files/"+upload.id()).exchange().expectStatus().isOk().expectHeader().valueMatches("Content-Disposition","attachment;.*").expectHeader().valueEquals("X-Content-Type-Options","nosniff").expectHeader().valueEquals("Content-Security-Policy","default-src 'none'; sandbox");
    http.delete().uri("/api/v1/account/files/"+upload.id()).cookie("HADESD_SESSION",a.cookie()).header(a.header(),a.token()).exchange().expectStatus().isEqualTo(409);
    http.put().uri("/api/v1/account/comments/"+comment.id()).cookie("HADESD_SESSION",b.cookie()).header(b.header(),b.token()).bodyValue(new EditComment("forged",null)).exchange().expectStatus().isNotFound();
    http.delete().uri("/api/v1/account/comments/"+comment.id()).cookie("HADESD_SESSION",b.cookie()).header(b.header(),b.token()).exchange().expectStatus().isNotFound();
    var reply=comments.create(second.id(),published.id(),new CreateComment("回复",comment.id(),null)).block();
    StepVerifier.create(comments.create(first.id(),published.id(),new CreateComment("nested",reply.id(),null))).expectErrorSatisfies(e->assertThat(((Problem)e).code).isEqualTo("INVALID_PARENT")).verify();
    http.get().uri("/api/v1/public/contents/"+published.id()+"/comments?size=100").exchange().expectStatus().isOk().expectBody().jsonPath("$.total").isEqualTo(2).jsonPath("$.items[1].parentId").isEqualTo(comment.id());
    http.put().uri("/api/v1/account/comments/"+comment.id()).cookie("HADESD_SESSION",a.cookie()).header(a.header(),a.token()).bodyValue(new EditComment("改文字保留附件",null))
        .exchange().expectStatus().isOk().expectBody().jsonPath("$.attachments.length()").isEqualTo(1);
    http.put().uri("/api/v1/account/comments/"+comment.id()).cookie("HADESD_SESSION",a.cookie()).header(a.header(),a.token()).bodyValue(new EditComment("解绑",List.of()))
        .exchange().expectStatus().isOk().expectBody().jsonPath("$.attachments.length()").isEqualTo(0);
    http.get().uri("/api/v1/public/comment-files/"+upload.id()).exchange().expectStatus().isNotFound();
    http.delete().uri("/api/v1/account/files/"+upload.id()).cookie("HADESD_SESSION",a.cookie()).header(a.header(),a.token()).exchange().expectStatus().isNoContent();
  }

  @Test void withdrawalModerationAndAdminAttachmentsKeepPublicationBoundary() throws Exception {
    var content=publish(); var reader=reader(); var s=login(reader.username(),PASSWORD); var admin=login("test-admin",PASSWORD);
    byte[] png=Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9p8AAAAASUVORK5CYII=");
    var image=upload(s,"tiny.png",png,"/api/v1/account/files");
    var comment=comments.create(reader.id(),content.id(),new CreateComment("published attachment",null,List.of(image.id()))).block();
    http.get().uri("/api/v1/public/comment-files/"+image.id()).exchange().expectStatus().isOk().expectHeader().valueMatches("Content-Disposition","inline;.*");
    http.get().uri("/api/v1/public/comment-files/"+image.id()+"?download=true").exchange().expectStatus().isOk().expectHeader().valueMatches("Content-Disposition","attachment;.*");
    releases.create(new PublishRequest(Operation.WITHDRAW,content.id(),null,null)).block(); deploy();
    http.get().uri("/api/v1/public/contents/"+content.id()+"/comments").exchange().expectStatus().isNotFound();
    http.get().uri("/api/v1/public/comment-files/"+image.id()).exchange().expectStatus().isNotFound();
    http.get().uri("/api/v1/account/files/"+image.id()+"/content").cookie("HADESD_SESSION",s.cookie()).exchange().expectStatus().isOk();
    http.get().uri("/api/v1/admin/comments?contentId="+content.id()).cookie("HADESD_SESSION",admin.cookie()).exchange().expectStatus().isOk().expectBody().jsonPath("$.total").isEqualTo(1);
    http.delete().uri("/api/v1/admin/comments/"+comment.id()).cookie("HADESD_SESSION",admin.cookie()).header(admin.header(),admin.token()).exchange().expectStatus().isNoContent();
    releases.create(new PublishRequest(Operation.PUBLISH,content.id(),content.latestRevision().id(),null)).block(); deploy();
    http.get().uri("/api/v1/public/contents/"+content.id()+"/comments").exchange().expectStatus().isOk().expectBody().jsonPath("$.total").isEqualTo(0);
    http.get().uri("/api/v1/public/comment-files/"+image.id()).exchange().expectStatus().isNotFound();
    var text=upload(admin,"source.md","# Source documentation".getBytes(),"/api/v1/admin/media");
    http.get().uri("/api/v1/admin/media/"+text.id()+"/content").cookie("HADESD_SESSION",admin.cookie()).exchange().expectStatus().isOk().expectHeader().valueMatches("Content-Disposition","attachment;.*");
    http.get().uri("/api/v1/public/media/"+text.id()).exchange().expectStatus().isNotFound();
    http.get().uri("/api/v1/account/files/"+text.id()+"/content").cookie("HADESD_SESSION",s.cookie()).exchange().expectStatus().isNotFound();
  }


  @Test void simultaneousUploadsRespectAccountQuotaAndCleanFailedStorage() throws Exception {
    var reader=reader();
    for(int i=0;i<99;i++) db.sql("INSERT INTO user_file(id,owner_id,filename,mime,byte_size,created_at,sha256) VALUES(:id,:owner,'seed.txt','text/plain',1,:now,:hash)")
        .bind("id",UUID.randomUUID().toString()).bind("owner",reader.id()).bind("now",Instant.now().toString()).bind("hash","0".repeat(64)).fetch().rowsUpdated().block();
    long before;
    try(var paths=Files.list(mediaRoot)){before=paths.count();}
    var outcomes=Mono.zip(files.upload(reader.id(),part("one.txt")).materialize(),files.upload(reader.id(),part("two.txt")).materialize()).block();
    var signals=List.of(outcomes.getT1(),outcomes.getT2());
    assertThat(signals.stream().filter(reactor.core.publisher.Signal::isOnNext)).hasSize(1);
    assertThat(signals.stream().filter(reactor.core.publisher.Signal::isOnError).map(s->((Problem)s.getThrowable()).code)).containsExactly("FILE_QUOTA_EXCEEDED");
    assertThat(files.list(reader.id(),0,100).block().total()).isEqualTo(100);
    try(var paths=Files.list(mediaRoot)){assertThat(paths.count()).isEqualTo(before+1);}
  }

  static org.springframework.http.codec.multipart.FilePart part(String filename) {
    var part=org.mockito.Mockito.mock(org.springframework.http.codec.multipart.FilePart.class);
    org.mockito.Mockito.when(part.filename()).thenReturn(filename);
    org.mockito.Mockito.when(part.content()).thenAnswer(invocation->reactor.core.publisher.Flux.just(
        org.springframework.core.io.buffer.DefaultDataBufferFactory.sharedInstance.wrap("owned text".getBytes())));
    return part;
  }

  @Test void registrationAndCommentRateLimitsCannotBeBypassedByChangingContentId() {
    var s=csrf(null);
    for(int i=0;i<5;i++) http.post().uri("/api/v1/auth/register").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(Map.of("username","!invalid","displayName","name","password",PASSWORD)).exchange().expectStatus().isBadRequest();
    http.post().uri("/api/v1/auth/register").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(Map.of("username","!invalid","displayName","name","password",PASSWORD)).exchange().expectStatus().isEqualTo(429).expectHeader().valueEquals("Retry-After","60");
    for(int i=0;i<20;i++) http.post().uri("/api/v1/public/contents/"+UUID.randomUUID()+"/comments").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(Map.of("body","rate")).exchange().expectStatus().isUnauthorized();
    http.post().uri("/api/v1/public/contents/"+UUID.randomUUID()+"/comments").cookie("HADESD_SESSION",s.cookie()).header(s.header(),s.token()).bodyValue(Map.of("body","rate")).exchange().expectStatus().isEqualTo(429);
  }
}
