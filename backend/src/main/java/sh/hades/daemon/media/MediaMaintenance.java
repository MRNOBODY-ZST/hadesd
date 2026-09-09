package sh.hades.daemon.media;

import java.sql.DriverManager;
import java.time.*;
import java.util.*;
import org.flywaydb.core.Flyway;

/**
 * Controlled local maintenance. Dry-run by default; immutable draft revisions are always protected.
 */
public final class MediaMaintenance {
  private MediaMaintenance() {}

  public static void run(boolean apply) throws Exception {
    String url =
        "jdbc:mysql://"
            + env("DB_HOST", "127.0.0.1")
            + ":"
            + env("DB_PORT", "13306")
            + "/"
            + env("DB_NAME", "hadesd")
            + "?connectionTimeZone=UTC";
    String user = env("DB_USERNAME", "hadesd"), pass = env("DB_PASSWORD", "");
    Flyway.configure()
        .dataSource(url, user, pass)
        .locations("classpath:db/migration")
        .load()
        .migrate();
    StoragePort storage =
        env("STORAGE_MODE", "local").equals("s3")
            ? new S3Storage(
                env("S3_BUCKET", ""),
                env("S3_REGION", "us-east-1"),
                env("S3_ENDPOINT", ""),
                Boolean.parseBoolean(env("S3_PATH_STYLE", "false")))
            : new LocalStorage(env("MEDIA_ROOT", "../.local/media"));
    int count = 0;
    try (var connection = DriverManager.getConnection(url, user, pass)) {
      var ids = new ArrayList<String>();
      try (var candidates =
          connection.prepareStatement(
              "SELECT id FROM media m WHERE m.created_at<? AND NOT EXISTS(SELECT 1 FROM"
                  + " revision_media rm WHERE rm.media_id=m.id) AND NOT EXISTS(SELECT 1 FROM"
                  + " release_media rel WHERE rel.media_id=m.id)")) {
        candidates.setString(1, Instant.now().minus(Duration.ofDays(7)).toString());
        try (var rows = candidates.executeQuery()) {
          while (rows.next()) ids.add(rows.getString(1));
        }
      }
      if (!apply) {
        System.out.println(
            "Dry run: "
                + ids.size()
                + " unreferenced objects older than seven days. Add --apply to remove them.");
        return;
      }
      for (String id : ids) {
        connection.setAutoCommit(false);
        try {
          // Lock the object so a concurrent revision cannot acquire a new foreign-key reference
          // during deletion.
          try (var lock =
              connection.prepareStatement("SELECT id FROM media WHERE id=? FOR UPDATE")) {
            lock.setString(1, id);
            try (var rows = lock.executeQuery()) {
              if (!rows.next()) {
                connection.rollback();
                continue;
              }
            }
          }
          long refs;
          try (var check =
              connection.prepareStatement(
                  "SELECT (SELECT COUNT(*) FROM revision_media WHERE media_id=?)+(SELECT COUNT(*)"
                      + " FROM release_media WHERE media_id=?)")) {
            check.setString(1, id);
            check.setString(2, id);
            try (var rows = check.executeQuery()) {
              rows.next();
              refs = rows.getLong(1);
            }
          }
          if (refs > 0) {
            connection.rollback();
            continue;
          }
          storage.delete(id).block(Duration.ofSeconds(30));
          try (var delete = connection.prepareStatement("DELETE FROM media WHERE id=?")) {
            delete.setString(1, id);
            delete.executeUpdate();
          }
          connection.commit();
          count++;
        } catch (Exception e) {
          connection.rollback();
          throw e;
        } finally {
          connection.setAutoCommit(true);
        }
      }
    } finally {
      if (storage instanceof AutoCloseable closeable) closeable.close();
    }
    System.out.println(
        "Removed "
            + count
            + " unreferenced media objects. Revision history and retained releases remain"
            + " protected.");
  }

  private static String env(String key, String fallback) {
    return System.getenv().getOrDefault(key, fallback);
  }
}
