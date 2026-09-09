package sh.hades.daemon.audit;

import java.time.Instant;
import java.util.UUID;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

@Service
public class AuditService {
  private final DatabaseClient db;

  public AuditService(DatabaseClient db) {
    this.db = db;
  }

  public Mono<Void> record(String event, String subject) {
    return db.sql(
            "INSERT INTO audit_event(id,event,subject_id,created_at) VALUES"
                + " (:id,:event,:subject,:now)")
        .bind("id", UUID.randomUUID().toString())
        .bind("event", event)
        .bind("subject", subject)
        .bind("now", Instant.now().toString())
        .fetch()
        .rowsUpdated()
        .then();
  }
}
