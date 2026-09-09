package sh.hades.daemon.community;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.reactive.TransactionalOperator;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.community.CommunityApi.*;
import sh.hades.daemon.shared.Problem;

@Service
public class AccountService {
  private final DatabaseClient db;
  private final PasswordEncoder passwords;
  private final TransactionalOperator tx;
  private final AuditService audit;
  private static final Set<String> RESERVED = Set.of("admin", "administrator", "root", "system", "moderator", "hadesd", "管理员", "管理員");

  public AccountService(DatabaseClient db, PasswordEncoder passwords, TransactionalOperator tx, AuditService audit) {
    this.db = db; this.passwords = passwords; this.tx = tx; this.audit = audit;
  }

  static User map(io.r2dbc.spi.Row r) {
    return new User(r.get("id", String.class), r.get("username", String.class), r.get("display_name", String.class), r.get("role", String.class));
  }

  public Mono<User> current(String username) {
    return db.sql("SELECT * FROM blog_account WHERE username=:username")
        .bind("username", username).map((r,m) -> map(r)).one()
        .switchIfEmpty(Mono.error(new Problem(401, "UNAUTHENTICATED", "账号不存在，请重新登录")));
  }

  public Mono<User> byId(String id) {
    return db.sql("SELECT * FROM blog_account WHERE id=:id").bind("id", id)
        .map((r,m) -> map(r)).one().switchIfEmpty(Mono.error(Problem.missing("账号不存在")));
  }

  public static void validatePassword(String password) {
    if (password == null || password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72)
      throw Problem.bad("INVALID_PASSWORD", "密码至少 12 个字符且不超过 72 UTF-8 字节");
  }

  private String displayName(String name) {
    if (name == null || name.strip().isEmpty() || name.strip().length() > 60 || name.codePoints().anyMatch(Character::isISOControl))
      throw Problem.bad("INVALID_DISPLAY_NAME", "昵称应为 1–60 个字符，不能包含控制字符");
    return name.strip();
  }

  private Mono<Void> protectAdminIdentity(String username, String displayName) {
    String normalized = displayName.toLowerCase(Locale.ROOT).replaceAll("[\\s_.-]", "");
    if (RESERVED.contains(username) || username.contains("admin") || RESERVED.contains(normalized))
      return Mono.error(Problem.bad("RESERVED_USERNAME", "此用户名或昵称保留给系统账号"));
    return db.sql("SELECT COUNT(*) n FROM blog_account WHERE role='ADMIN' AND (username=:user OR username=:display OR display_name=:display)")
        .bind("user", username).bind("display", displayName)
        .map((r,m) -> r.get("n", Long.class)).one()
        .flatMap(n -> n > 0 ? Mono.error(Problem.bad("RESERVED_USERNAME", "此用户名或昵称保留给系统账号")) : Mono.empty());
  }

  public Mono<User> register(Register input) {
    return Mono.defer(() -> {
      if (input.username() == null || !input.username().matches("[a-z0-9][a-z0-9_.-]{2,31}"))
        return Mono.error(Problem.bad("INVALID_USERNAME", "用户名应为 3–32 位小写字母、数字、点、横线或下划线"));
      validatePassword(input.password());
      String display = displayName(input.displayName());
      String id = UUID.randomUUID().toString(), now = Instant.now().toString();
      return protectAdminIdentity(input.username(), display)
          .then(Mono.fromCallable(() -> passwords.encode(input.password())).subscribeOn(Schedulers.boundedElastic()))
          .flatMap(hash -> db.sql("INSERT INTO blog_account(id,username,display_name,password_hash,role,created_at) VALUES(:id,:user,:display,:hash,'USER',:now)")
              .bind("id", id).bind("user", input.username()).bind("display", display).bind("hash", hash).bind("now", now)
              .fetch().rowsUpdated().then(audit.record("ACCOUNT_REGISTERED", id))
              .thenReturn(new User(id, input.username(), display, "USER")).as(tx::transactional))
          .onErrorMap(DuplicateKeyException.class, e -> Problem.conflict("USERNAME_TAKEN", "用户名已被使用"));
    });
  }

  public Mono<User> profile(String username, Profile input) {
    return Mono.defer(() -> {
      String display = displayName(input.displayName());
      return current(username).flatMap(user ->
          (user.role().equals("ADMIN") ? Mono.<Void>empty() : protectAdminIdentity(username, display))
              .then(db.sql("UPDATE blog_account SET display_name=:display WHERE id=:id")
                  .bind("display", display).bind("id", user.id()).fetch().rowsUpdated())
              .then(audit.record("ACCOUNT_PROFILE_CHANGED", user.id()))
              .thenReturn(new User(user.id(), user.username(), display, user.role()))).as(tx::transactional);
    });
  }

  public Mono<Void> password(String username, Password input) {
    return Mono.defer(() -> {
      validatePassword(input.newPassword());
      if (input.currentPassword() == null || input.currentPassword().getBytes(StandardCharsets.UTF_8).length > 72)
        return Mono.error(Problem.bad("INVALID_PASSWORD", "当前密码无效"));
      return db.sql("SELECT password_hash FROM blog_account WHERE username=:user")
          .bind("user", username).map((r,m) -> r.get("password_hash", String.class)).one()
          .switchIfEmpty(Mono.error(new Problem(401, "UNAUTHENTICATED", "请重新登录")))
          .flatMap(old -> Mono.fromCallable(() -> {
              if (!passwords.matches(input.currentPassword(), old)) throw new Problem(400, "CURRENT_PASSWORD_INVALID", "当前密码错误");
              return passwords.encode(input.newPassword());
            }).subscribeOn(Schedulers.boundedElastic())
            .flatMap(hash -> db.sql("UPDATE blog_account SET password_hash=:hash WHERE username=:user AND password_hash=:old")
                .bind("hash", hash).bind("user", username).bind("old", old).fetch().rowsUpdated()
                .flatMap(n -> n != 1 ? Mono.error(Problem.conflict("PASSWORD_CHANGED", "密码已更改，请重新登录"))
                  : db.sql("UPDATE admin_account SET password_hash=:hash WHERE username=:user")
                    .bind("hash", hash).bind("user", username).fetch().rowsUpdated().then())
                .then(audit.record("ACCOUNT_PASSWORD_CHANGED", username)).as(tx::transactional)));
    });
  }
}
