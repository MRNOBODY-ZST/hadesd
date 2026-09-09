package sh.hades.daemon.auth;

import java.time.Instant;
import java.util.List;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.*;
import tools.jackson.databind.ObjectMapper;

/** Atomic, expiring Redis counters; no untrusted proxy header decides the peer identity. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestGuards implements WebFilter {
  private final java.util.concurrent.ConcurrentHashMap<
          String, java.util.concurrent.atomic.AtomicInteger>
      fallback = new java.util.concurrent.ConcurrentHashMap<>();
  private volatile long fallbackWindow;
  private final ReactiveStringRedisTemplate redis;
  private final ObjectMapper json;
  private static final DefaultRedisScript<Long> RATE =
      new DefaultRedisScript<>(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],61) end;"
              + " return n",
          Long.class);

  public RequestGuards(ReactiveStringRedisTemplate redis, ObjectMapper json) {
    this.redis = redis;
    this.json = json;
  }

  public Mono<Void> filter(ServerWebExchange ex, WebFilterChain chain) {
    String path = ex.getRequest().getPath().value();
    ex.getResponse().getHeaders().set("X-Request-Id", ex.getRequest().getId());
    if (path.startsWith("/api/v1/admin")
        || path.startsWith("/api/v1/account")
        || path.startsWith("/api/v1/auth")
        || path.startsWith("/api/v1/internal"))
      ex.getResponse().getHeaders().setCacheControl("no-store");
    boolean write = ex.getRequest().getMethod() != org.springframework.http.HttpMethod.GET;
    String bucket = path;
    int max = 0;
    if (path.equals("/api/v1/auth/login")) max = 10;
    else if (path.equals("/api/v1/auth/register") && write) max = 5;
    else if (path.equals("/api/v1/account/password") && write) max = 5;
    else if (path.equals("/api/v1/public/search")) max = 60;
    else if ((path.equals("/api/v1/admin/media") || path.equals("/api/v1/account/files")) && write) max = 20;
    else if (write && (path.matches("/api/v1/public/contents/[^/]+/comments") || path.startsWith("/api/v1/account/comments"))) {
      max = 20;
      bucket = "comment-write";
    }
    final int limit = max;
    if (max == 0) return chain.filter(ex);
    var remote = ex.getRequest().getRemoteAddress();
    // ForwardedHeaderTransformer deliberately keeps addresses unresolved to avoid DNS.
    // Read the host text from the already-normalized request, never raw proxy headers.
    String peer = remote == null ? "local" : remote.getHostString();
    String key = "hadesd:rate:" + bucket + ":" + peer + ":" + (Instant.now().getEpochSecond() / 60);
    return redis
        .execute(RATE, List.of(key), List.of())
        .single()
        .timeout(java.time.Duration.ofSeconds(2))
        .onErrorResume(
            e ->
                path.equals("/api/v1/public/search")
                    ? Mono.just(-1L)
                    : Mono.error(new Problem(503, "SESSION_UNAVAILABLE", "会话或限流服务暂不可用")))
        .flatMap(
            n -> {
              if (n < 0) return fallback(ex, chain, peer);
              if (n > limit) {
                ex.getResponse().getHeaders().set("Retry-After", "60");
                return Errors.write(ex, new Problem(429, "RATE_LIMITED", "请求过于频繁，请稍后重试"), json);
              }
              return chain.filter(ex);
            });
  }

  private Mono<Void> fallback(ServerWebExchange ex, WebFilterChain chain, String peer) {
    long window = Instant.now().getEpochSecond() / 60;
    synchronized (fallback) {
      if (fallbackWindow != window) {
        fallback.clear();
        fallbackWindow = window;
      }
    }
    if (fallback.size() >= 2048 && !fallback.containsKey(peer))
      return Errors.write(ex, new Problem(429, "RATE_LIMITED", "搜索暂时繁忙，请稍后重试"), json);
    if (fallback
            .computeIfAbsent(peer, k -> new java.util.concurrent.atomic.AtomicInteger())
            .incrementAndGet()
        > 20) return Errors.write(ex, new Problem(429, "RATE_LIMITED", "搜索降级期间请降低请求频率"), json);
    return chain.filter(ex);
  }
}
