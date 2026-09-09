package sh.hades.daemon.settings;

import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import sh.hades.daemon.audit.AuditService;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

@Service
public class SettingsService {
  private final DatabaseClient db;
  private final ObjectMapper json;
  private final AuditService audit;

  public SettingsService(DatabaseClient db, ObjectMapper json, AuditService audit) {
    this.db = db;
    this.json = json;
    this.audit = audit;
  }

  public Mono<SiteSettings> get() {
    return db.sql("SELECT document FROM site_settings WHERE singleton=1")
        .map((r, m) -> json.readValue(r.get("document", String.class), SiteSettings.class))
        .one()
        .defaultIfEmpty(SiteSettings.defaults());
  }

  public Mono<SiteSettings> save(SiteSettings s) {
    if (s.navigation().stream().anyMatch(n -> !n.href().matches("/(?!/)[A-Za-z0-9/_-]*"))
        || s.links().stream().anyMatch(l -> !safeUrl(l.url())))
      return Mono.error(Problem.bad("UNSAFE_LINK", "导航须为站内路径，外部链接仅允许 HTTPS、HTTP 或邮件地址"));
    return db.sql(
            "INSERT INTO site_settings(singleton,document) VALUES(1,:doc) ON DUPLICATE KEY UPDATE"
                + " document=:doc")
        .bind("doc", json.writeValueAsString(s))
        .fetch()
        .rowsUpdated()
        .then(audit.record("SETTINGS_SAVED", "site"))
        .thenReturn(s);
  }

  private boolean safeUrl(String value) {
    try {
      var u = java.net.URI.create(value);
      return ("https".equals(u.getScheme()) || "http".equals(u.getScheme()))
              && u.getHost() != null
              && u.getUserInfo() == null
          || "mailto".equals(u.getScheme()) && !value.contains("\n") && !value.contains("\r");
    } catch (Exception e) {
      return false;
    }
  }
}
