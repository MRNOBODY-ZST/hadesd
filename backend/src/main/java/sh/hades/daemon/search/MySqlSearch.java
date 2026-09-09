package sh.hades.daemon.search;

import java.util.*;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.Api;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;

@Service
public class MySqlSearch implements SearchPort {
  private final DatabaseClient db;

  public MySqlSearch(DatabaseClient db) {
    this.db = db;
  }

  public static boolean metadataOnly(String q) {
    return q.codePointCount(0, q.length()) < 2 || q.matches(".*[^\\p{L}\\p{N}\\s].*");
  }

  public static String like(String q) {
    return "%" + q.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
  }

  public Mono<Page<PublicContent>> search(
      ReleaseSnapshot snapshot, String query, int page, int size) {
    Api.bounds(page, size);
    String q = query == null ? "" : query.strip();
    if (q.length() > 200) return Mono.error(Problem.bad("QUERY_TOO_LONG", "搜索词最多 200 字符"));
    if (q.isBlank() || snapshot.contents().isEmpty())
      return Mono.just(new Page<>(List.of(), page, size, 0));
    boolean shortQuery = metadataOnly(q);
    String predicate =
        shortQuery
            ? "(title LIKE :query ESCAPE '!' OR tags LIKE :query ESCAPE '!')"
            : "MATCH(title,summary,plain_text,tags) AGAINST (:query IN NATURAL LANGUAGE MODE)";
    String param = shortQuery ? like(q) : q;
    var ids =
        db.sql(
                "SELECT content_id FROM release_entry WHERE release_id=:rid AND "
                    + predicate
                    + " ORDER BY title,content_id LIMIT :size OFFSET :offset")
            .bind("rid", snapshot.releaseId())
            .bind("query", param)
            .bind("size", size)
            .bind("offset", (long) page * size)
            .map((r, m) -> r.get("content_id", String.class))
            .all()
            .collectList();
    var count =
        db.sql("SELECT COUNT(*) n FROM release_entry WHERE release_id=:rid AND " + predicate)
            .bind("rid", snapshot.releaseId())
            .bind("query", param)
            .map((r, m) -> r.get("n", Long.class))
            .one();
    Map<String, PublicContent> byId = new HashMap<>();
    snapshot.contents().forEach(c -> byId.put(c.id(), c));
    return Mono.zip(ids, count)
        .map(
            t ->
                new Page<>(
                    t.getT1().stream().map(byId::get).filter(Objects::nonNull).toList(),
                    page,
                    size,
                    t.getT2()));
  }
}
