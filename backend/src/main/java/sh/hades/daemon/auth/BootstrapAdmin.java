package sh.hades.daemon.auth;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import org.flywaydb.core.Flyway;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/** Controlled local process only. Never enabled as an HTTP endpoint or automatic startup seed. */
public final class BootstrapAdmin {
  private BootstrapAdmin() {}

  public static void run() throws Exception {
    String user = required("ADMIN_BOOTSTRAP_USERNAME"),
        file = required("ADMIN_BOOTSTRAP_PASSWORD_FILE");
    if (!user.matches("[A-Za-z0-9_.-]{3,100}"))
      throw new IllegalArgumentException("Bootstrap username must be 3–100 safe characters");
    String pass = Files.readString(Path.of(file)).stripTrailing();
    if (pass.length() < 14 || pass.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72)
      throw new IllegalArgumentException(
          "Bootstrap password must contain at least 14 characters and at most 72 UTF-8 bytes");
    String url =
        "jdbc:mysql://"
            + env("DB_HOST", "127.0.0.1")
            + ":"
            + env("DB_PORT", "13306")
            + "/"
            + env("DB_NAME", "hadesd")
            + "?connectionTimeZone=UTC";
    String dbUser = env("DB_USERNAME", "hadesd"), dbPass = required("DB_PASSWORD");
    Flyway.configure()
        .dataSource(url, dbUser, dbPass)
        .locations("classpath:db/migration")
        .load()
        .migrate();
    try (var conn = DriverManager.getConnection(url, dbUser, dbPass)) {
      conn.setAutoCommit(false);
      try {
        String hash = new BCryptPasswordEncoder(12).encode(pass), now = Instant.now().toString();
        try (var stmt = conn.prepareStatement(
            "INSERT INTO admin_account(singleton,username,password_hash,created_at) VALUES(1,?,?,?)")) {
          stmt.setString(1, user); stmt.setString(2, hash); stmt.setString(3, now); stmt.executeUpdate();
        }
        try (var stmt = conn.prepareStatement(
            "INSERT INTO blog_account(id,username,display_name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)")) {
          stmt.setString(1, java.util.UUID.randomUUID().toString()); stmt.setString(2, user);
          stmt.setString(3, user.substring(0, Math.min(60, user.length())));
          stmt.setString(4, hash); stmt.setString(5, now); stmt.executeUpdate();
        }
        conn.commit();
      } catch (Exception error) {
        conn.rollback(); throw error;
      }
    }
    System.out.println("Administrator created. Existing accounts are never overwritten.");
  }

  private static String required(String key) {
    String value = System.getenv(key);
    if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " is required");
    return value;
  }

  private static String env(String key, String fallback) {
    return System.getenv().getOrDefault(key, fallback);
  }
}
