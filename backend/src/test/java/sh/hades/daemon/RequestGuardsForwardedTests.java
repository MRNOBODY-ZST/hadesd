package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.ReactiveStringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.web.server.adapter.ForwardedHeaderTransformer;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;
import sh.hades.daemon.auth.RequestGuards;
import tools.jackson.databind.ObjectMapper;

class RequestGuardsForwardedTests {
  @Test
  void publicMediaUsesOneVisitorBudgetAcrossDifferentFilesAndCommentAttachments() {
    var redis = mock(ReactiveStringRedisTemplate.class);
    doReturn(Flux.just(240L), Flux.just(241L)).when(redis).execute(any(RedisScript.class), anyList(), anyList());
    var guard = new RequestGuards(redis, new ObjectMapper());
    var first = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/public/media/one")
        .remoteAddress(new InetSocketAddress("192.0.2.50", 30000)));
    var second = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/public/comment-files/two")
        .remoteAddress(new InetSocketAddress("192.0.2.50", 30001)));
    var reached = new java.util.concurrent.atomic.AtomicInteger();
    for (var exchange : List.of(first, second))
      StepVerifier.create(guard.filter(exchange, e -> { reached.incrementAndGet(); return Mono.empty(); })).verifyComplete();
    assertThat(reached.get()).isEqualTo(1);
    assertThat(second.getResponse().getStatusCode().value()).isEqualTo(429);
    assertThat(second.getResponse().getHeaders().getFirst("Retry-After")).isEqualTo("60");
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<String>> keys = ArgumentCaptor.forClass(List.class);
    verify(redis, times(2)).execute(any(RedisScript.class), keys.capture(), eq(List.of()));
    assertThat(keys.getAllValues()).allSatisfy(value ->
        assertThat(value.getFirst()).startsWith("hadesd:rate:public-media:192.0.2.50:"));
  }

  @Test
  void redisOutageKeepsBoundedMediaReadsSeparateFromSearchFallback() {
    var redis = mock(ReactiveStringRedisTemplate.class);
    doReturn(Flux.error(new IllegalStateException("offline"))).when(redis).execute(any(RedisScript.class), anyList(), anyList());
    var guard = new RequestGuards(redis, new ObjectMapper());
    var reached = new java.util.concurrent.atomic.AtomicInteger();
    for (int i = 0; i < 61; i++) {
      var exchange = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/public/media/" + i));
      StepVerifier.create(guard.filter(exchange, e -> { reached.incrementAndGet(); return Mono.empty(); })).verifyComplete();
      if (i == 60) assertThat(exchange.getResponse().getStatusCode().value()).isEqualTo(429);
    }
    assertThat(reached.get()).isEqualTo(60);
    var search = MockServerWebExchange.from(MockServerHttpRequest.get("/api/v1/public/search?q=test"));
    StepVerifier.create(guard.filter(search, e -> { reached.incrementAndGet(); return Mono.empty(); })).verifyComplete();
    assertThat(reached.get()).isEqualTo(61);
  }

  @Test
  void forwardedIpv4AndIpv6UseUnresolvedClientAddressesWithoutDns() {
    for (String client : List.of("203.0.113.27", "2001:db8::27")) {
      var original = MockServerHttpRequest.post("http://backend:8080/api/v1/auth/login")
          .remoteAddress(new InetSocketAddress("10.77.0.1", 32100))
          .header("X-Forwarded-For", client)
          .header("X-Forwarded-Proto", "https")
          .header("X-Forwarded-Host", "hadesd.sh")
          .header("X-Forwarded-Port", "443")
          .build();
      var transformed = new ForwardedHeaderTransformer(false).apply(original);
      var remote = transformed.getRemoteAddress();
      assertThat(remote).isNotNull();
      assertThat(remote.isUnresolved()).isTrue();
      assertThat(remote.getAddress()).isNull();
      assertThat(transformed.getURI().toString()).isEqualTo("https://hadesd.sh/api/v1/auth/login");
      assertThat(transformed.getHeaders().getFirst("X-Forwarded-For")).isNull();

      var redis = mock(ReactiveStringRedisTemplate.class);
      doReturn(Flux.just(1L)).when(redis).execute(any(RedisScript.class), anyList(), anyList());
      var guard = new RequestGuards(redis, new ObjectMapper());
      var exchange = MockServerWebExchange.from(original).mutate().request(transformed).build();
      var reached = new AtomicBoolean();
      StepVerifier.create(guard.filter(exchange, e -> {
        reached.set(true);
        return Mono.empty();
      })).verifyComplete();
      assertThat(reached).isTrue();
      @SuppressWarnings("unchecked")
      ArgumentCaptor<List<String>> keys = ArgumentCaptor.forClass(List.class);
      verify(redis).execute(any(RedisScript.class), keys.capture(), eq(List.of()));
      assertThat(keys.getValue()).hasSize(1);
      assertThat(keys.getValue().getFirst())
          .startsWith("hadesd:rate:/api/v1/auth/login:" + remote.getHostString() + ":")
          .doesNotContain("10.77.0.1");
    }
  }

  @Test
  void rawForwardedHeadersNeverOverrideTheSocketWithoutTheTrustedTransformer() {
    var original = MockServerHttpRequest.post("http://backend:8080/api/v1/auth/login")
        .remoteAddress(new InetSocketAddress("192.0.2.40", 32100))
        .header("X-Forwarded-For", "203.0.113.99")
        .header("Forwarded", "for=203.0.113.99;proto=https")
        .build();
    var redis = mock(ReactiveStringRedisTemplate.class);
    doReturn(Flux.just(1L)).when(redis).execute(any(RedisScript.class), anyList(), anyList());
    var guard = new RequestGuards(redis, new ObjectMapper());
    StepVerifier.create(guard.filter(MockServerWebExchange.from(original), e -> Mono.empty()))
        .verifyComplete();
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<String>> keys = ArgumentCaptor.forClass(List.class);
    verify(redis).execute(any(RedisScript.class), keys.capture(), eq(List.of()));
    assertThat(keys.getValue().getFirst())
        .startsWith("hadesd:rate:/api/v1/auth/login:192.0.2.40:")
        .doesNotContain("203.0.113.99");
  }
}
