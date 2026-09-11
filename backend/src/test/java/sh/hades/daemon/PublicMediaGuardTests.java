package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.adapter.ForwardedHeaderTransformer;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import sh.hades.daemon.media.PublicMediaGuard;
import tools.jackson.databind.ObjectMapper;

class PublicMediaGuardTests {
  private final PublicMediaGuard guard = new PublicMediaGuard(new ObjectMapper());
  private static final String IMAGE = "https://hadesd.sh/api/v1/public/media/example";

  @Test
  void sameOriginImagesAndDirectLinksKeepPermissionChecksAndDisableSharedCaches() {
    for (var request : List.of(
        MockServerHttpRequest.get(IMAGE).build(),
        MockServerHttpRequest.get(IMAGE).header("Referer", "https://hadesd.sh/posts/a").header("Sec-Fetch-Site", "same-origin").build(),
        MockServerHttpRequest.get(IMAGE).header("Referer", "https://HADESD.sh:443/posts/a").build(),
        MockServerHttpRequest.get(IMAGE).header("Origin", "https://hadesd.sh").build(),
        MockServerHttpRequest.get(IMAGE).header("Sec-Fetch-Mode", "navigate").header("Sec-Fetch-Dest", "document").header("Sec-Fetch-Site", "cross-site").header("Referer", "https://example.org/").build())) {
      var exchange = MockServerWebExchange.from(request);
      var reached = new AtomicBoolean();
      StepVerifier.create(guard.filter(exchange, e -> { reached.set(true); return Mono.empty(); })).verifyComplete();
      assertThat(reached).isTrue();
      assertThat(exchange.getResponse().getHeaders().getFirst("Cross-Origin-Resource-Policy")).isEqualTo("same-origin");
      assertThat(exchange.getResponse().getHeaders().getFirst("X-Frame-Options")).isEqualTo("DENY");
      assertThat(exchange.getResponse().getHeaders().getFirst("Cache-Control")).isEqualTo("no-store");
      assertThat(exchange.getResponse().getHeaders().getFirst("Cloudflare-CDN-Cache-Control")).isEqualTo("no-store");
    }
  }

  @Test
  void foreignEmbedsAreRejectedBeforeLoadingBytesIncludingSpoofedSuffixesAndPorts() {
    for (String source : List.of("https://example.org/", "https://hadesd.sh.example.org/", "https://hadesd.sh:8443/", "http://hadesd.sh/", "https://hadesd.sh@example.org/", "https://sub.hadesd.sh/", "null", "invalid referrer")) {
      for (String header : List.of("Referer", "Origin")) reject(MockServerHttpRequest.get(IMAGE).header(header, source).build());
    }
    reject(MockServerHttpRequest.get(IMAGE).header("Sec-Fetch-Site", "cross-site").build());
    reject(MockServerHttpRequest.get(IMAGE).header("Sec-Fetch-Site", "same-site").build());
    reject(MockServerHttpRequest.get(IMAGE).header("Sec-Fetch-Site", "cross-site").header("Sec-Fetch-Mode", "navigate").header("Sec-Fetch-Dest", "iframe").build());
    reject(MockServerHttpRequest.get(IMAGE).header("Sec-Fetch-Site", "cross-site").header("Sec-Fetch-Mode", "navigate").header("Sec-Fetch-Dest", "object").build());
    reject(MockServerHttpRequest.get("https://hadesd.sh/api/v1/public/comment-files/example").header("Sec-Fetch-Site", "cross-site").build());
  }

  private void reject(MockServerHttpRequest request) {
    var exchange = MockServerWebExchange.from(request);
    var reached = new AtomicBoolean();
    StepVerifier.create(guard.filter(exchange, e -> { reached.set(true); return Mono.empty(); })).verifyComplete();
    assertThat(reached).isFalse();
    assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    assertThat(exchange.getResponse().getBodyAsString().block()).contains("MEDIA_HOTLINK_BLOCKED");
  }

  @Test
  void trustedProxyOriginIsUsedWithoutConsultingRawForwardedHeaders() {
    var request = MockServerHttpRequest.get("http://backend:8080/api/v1/public/media/example")
        .header("X-Forwarded-Proto", "https").header("X-Forwarded-Host", "hadesd.sh")
        .header("X-Forwarded-Port", "443").header("Referer", "https://hadesd.sh/posts/a").build();
    var trusted = new ForwardedHeaderTransformer(false).apply(request);
    var exchange = MockServerWebExchange.from(request).mutate().request(trusted).build();
    var reached = new AtomicBoolean();
    StepVerifier.create(guard.filter(exchange, e -> { reached.set(true); return Mono.empty(); })).verifyComplete();
    assertThat(reached).isTrue();
    reject(request);
  }

  @Test
  void privateMediaAndOtherPublicApisKeepExistingSecurityChains() {
    for (String path : List.of("/api/v1/admin/media/id/content", "/api/v1/account/files/id/content", "/api/v1/public/search", "/api/v1/public/contents/id")) {
      var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("https://hadesd.sh" + path).header("Referer", "https://example.org"));
      var reached = new AtomicBoolean();
      StepVerifier.create(guard.filter(exchange, e -> { reached.set(true); return Mono.empty(); })).verifyComplete();
      assertThat(reached).isTrue();
      assertThat(exchange.getResponse().getHeaders().getFirst("Cross-Origin-Resource-Policy")).isNull();
    }
  }
}
