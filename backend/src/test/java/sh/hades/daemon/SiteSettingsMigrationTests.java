package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Map;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.json.JsonMapper;

@Testcontainers
class SiteSettingsMigrationTests {
  @Container
  static MySQLContainer mysql = new MySQLContainer(DockerImageName.parse("mysql:8.4.11"))
      .withDatabaseName("site_settings_migration_test")
      .withUsername("migration_test")
      .withPassword("temporary-migration-test-password")
      .withCommand("--ngram-token-size=2");

  private final JsonMapper json = JsonMapper.builder().build();

  @BeforeEach
  void createLegacySchema() {
    var flyway = configuration().target("5").load();
    flyway.clean();
    flyway.migrate();
  }

  @Test
  void backfillsLatestSuccessfulSiteWithoutCopyingANewerFailedRelease() throws Exception {
    var original = site("Original author");
    var latest = site("Preserved author");
    addRelease(original, "2026-09-01T00:00:00Z", "SUCCEEDED");
    addRelease(latest, "2026-09-02T00:00:00Z", "SUCCEEDED");
    addRelease(site("Unpublished author"), "2026-09-03T00:00:00Z", "FAILED");
    configuration().load().migrate();
    assertThat(readSettings()).isEqualTo(latest);
  }

  @Test
  void preservesAlreadySavedSettingsEvenWhenPublishedSettingsDiffer() throws Exception {
    var saved = site("Saved custom author");
    addRelease(site("Previously published author"), "2026-09-02T00:00:00Z", "SUCCEEDED");
    try (var connection = connection();
        var statement = connection.prepareStatement("INSERT INTO site_settings VALUES(1,?)")) {
      statement.setString(1, json.writeValueAsString(saved));
      statement.executeUpdate();
    }
    configuration().load().migrate();
    assertThat(readSettings()).isEqualTo(saved);
  }

  @Test
  void freshInstallationKeepsSettingsAbsentSoApplicationDefaultsApply() throws Exception {
    configuration().load().migrate();
    assertThat(readSettings()).isNull();
  }

  @Test
  void neverSeedsSettingsFromAnUnpublishedSnapshot() throws Exception {
    addRelease(site("Draft author"), "2026-09-02T00:00:00Z", "BUILDING");
    addRelease(site("Failed author"), "2026-09-03T00:00:00Z", "FAILED");
    configuration().load().migrate();
    assertThat(readSettings()).isNull();
  }

  private org.flywaydb.core.api.configuration.FluentConfiguration configuration() {
    return Flyway.configure().dataSource(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword())
        .locations("classpath:db/migration").cleanDisabled(false);
  }

  private Connection connection() throws Exception {
    return DriverManager.getConnection(mysql.getJdbcUrl(), mysql.getUsername(), mysql.getPassword());
  }

  private Map<String, Object> site(String author) {
    return Map.of("title", "A personal site", "tagline", "Keep this tagline", "introduction", author,
        "homeText", "Keep this biography", "navigation", java.util.List.of(), "links", java.util.List.of());
  }

  private void addRelease(Map<String, Object> site, String createdAt, String status) throws Exception {
    String id = UUID.randomUUID().toString();
    try (var connection = connection();
        var release = connection.prepareStatement("INSERT INTO release_snapshot(id,created_at,document) VALUES(?,?,?)");
        var job = connection.prepareStatement("INSERT INTO publish_job(id,release_id,operation,status,created_at) VALUES(?,?,'SETTINGS',?,?)")) {
      release.setString(1, id);
      release.setString(2, createdAt);
      release.setString(3, json.writeValueAsString(Map.of("releaseId", id, "createdAt", createdAt, "site", site, "contents", java.util.List.of())));
      release.executeUpdate();
      job.setString(1, UUID.randomUUID().toString());
      job.setString(2, id);
      job.setString(3, status);
      job.setString(4, createdAt);
      job.executeUpdate();
    }
  }

  private Map<?, ?> readSettings() throws Exception {
    try (var connection = connection(); var statement = connection.createStatement();
        var result = statement.executeQuery("SELECT document FROM site_settings WHERE singleton=1")) {
      return result.next() ? json.readValue(result.getString(1), Map.class) : null;
    }
  }
}
