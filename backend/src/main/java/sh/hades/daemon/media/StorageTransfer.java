package sh.hades.daemon.media;

import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.*;

/** Verified, resumable transfer of database-owned objects; source objects are never removed. */
public final class StorageTransfer {
  private static final Duration TIMEOUT = Duration.ofSeconds(65);
  private StorageTransfer() {}

  public record Item(String key, String mime, long bytes, String sha256) {}
  public record Report(int examined, int copied, int alreadyPresent, int pending, int legacyWithoutChecksum, long bytes, boolean dryRun) {}

  public static Report transfer(List<Item> items, StoragePort source, StoragePort target, boolean apply) throws Exception {
    int copied = 0, present = 0, pending = 0, legacy = 0;
    long totalBytes = 0;
    var seen = new HashSet<String>();
    for (var item : items) {
      StoragePort.validKey(item.key());
      if (!seen.add(item.key())) throw new IllegalStateException("Duplicate storage key: " + item.key());
      if (item.bytes() < 0 || item.bytes() > 25L * 1024 * 1024)
        throw new IllegalStateException("Invalid recorded size: " + item.key());
      byte[] bytes = source.read(item.key()).block(TIMEOUT);
      if (bytes == null || bytes.length != item.bytes())
        throw new IllegalStateException("Source size mismatch: " + item.key());
      String hash = sha256(bytes);
      if (item.sha256() == null || item.sha256().isBlank()) legacy++;
      else if (!hash.equalsIgnoreCase(item.sha256()))
        throw new IllegalStateException("Source checksum mismatch: " + item.key());
      if (Boolean.TRUE.equals(target.exists(item.key()).block(TIMEOUT))) {
        verifyDestination(target, item, hash);
        present++;
      } else if (apply) {
        // Both storage adapters use create-only writes, including concurrent races.
        target.put(item.key(), bytes, item.mime()).block(TIMEOUT);
        verifyDestination(target, item, hash);
        copied++;
      } else pending++;
      totalBytes += bytes.length;
    }
    return new Report(items.size(), copied, present, pending, legacy, totalBytes, !apply);
  }

  private static String sha256(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }

  private static void verifyDestination(StoragePort target, Item item, String hash) throws Exception {
    byte[] stored = target.read(item.key()).block(TIMEOUT);
    if (stored == null || stored.length != item.bytes() || !sha256(stored).equals(hash))
      throw new IllegalStateException("Destination checksum or size mismatch: " + item.key());
  }

  public static void run(String[] args) throws Exception {
    String from = null, to = null;
    boolean apply = false;
    for (String arg : args) {
      if (arg.equals("--storage-transfer")) continue;
      if (arg.equals("--apply")) apply = true;
      else if (arg.startsWith("--from=")) from = arg.substring(7);
      else if (arg.startsWith("--to=")) to = arg.substring(5);
      else throw new IllegalArgumentException("Unknown storage transfer argument: " + arg);
    }
    if (!("local".equals(from) && "s3".equals(to)) && !("s3".equals(from) && "local".equals(to)))
      throw new IllegalArgumentException("Use --from=local --to=s3 or --from=s3 --to=local; --apply performs writes");
    String sourceRoot = env("STORAGE_SOURCE_ROOT", env("MEDIA_ROOT", "../.local/media"));
    String targetRoot = env("STORAGE_TARGET_ROOT", "");
    if (to.equals("local") && targetRoot.isBlank())
      throw new IllegalArgumentException("STORAGE_TARGET_ROOT is required for an export to a separate local directory");

    // Only a metadata snapshot is read: no schema migrations, deletes or updates.
    String url = "jdbc:mysql://" + env("DB_HOST", "127.0.0.1") + ":" + env("DB_PORT", "13306")
        + "/" + env("DB_NAME", "hadesd") + "?connectionTimeZone=UTC";
    var items = new ArrayList<Item>();
    try (var connection = DriverManager.getConnection(url, env("DB_USERNAME", "hadesd"), env("DB_PASSWORD", ""))) {
      connection.setReadOnly(true);
      try (var statement = connection.prepareStatement(
          "SELECT storage_key,mime,byte_size,sha256 FROM media UNION ALL SELECT id,mime,byte_size,sha256 FROM user_file");
          var rows = statement.executeQuery()) {
        while (rows.next()) items.add(new Item(rows.getString(1), rows.getString(2), rows.getLong(3), rows.getString(4)));
      }
    }
    try (var s3 = new S3Storage(env("S3_BUCKET", ""), env("S3_REGION", "us-east-1"),
        env("S3_ENDPOINT", ""), Boolean.parseBoolean(env("S3_PATH_STYLE", "false")))) {
      StoragePort source = from.equals("local") ? new LocalStorage(sourceRoot) : s3;
      StoragePort target = to.equals("local") ? new LocalStorage(targetRoot) : s3;
      Report report = transfer(items, source, target, apply);
      String json = "{\"examined\":" + report.examined() + ",\"copied\":" + report.copied()
          + ",\"alreadyPresent\":" + report.alreadyPresent() + ",\"pending\":" + report.pending()
          + ",\"legacyWithoutChecksum\":" + report.legacyWithoutChecksum() + ",\"bytes\":" + report.bytes()
          + ",\"dryRun\":" + report.dryRun() + "}";
      String reportFile = env("STORAGE_TRANSFER_REPORT", "");
      if (!reportFile.isBlank())
        Files.writeString(Path.of(reportFile), json + "\n", StandardOpenOption.CREATE_NEW);
      System.out.println(json);
    }
  }

  private static String env(String key, String fallback) {
    return System.getenv().getOrDefault(key, fallback);
  }
}
