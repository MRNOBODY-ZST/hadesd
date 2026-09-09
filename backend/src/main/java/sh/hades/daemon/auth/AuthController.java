package sh.hades.daemon.auth;

import java.security.Principal;
import java.util.Map;
import org.springframework.security.web.server.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

@RestController
public class AuthController {
  private final sh.hades.daemon.community.AccountService accounts;

  public AuthController(sh.hades.daemon.community.AccountService accounts) { this.accounts = accounts; }
  @GetMapping("/api/v1/auth/csrf")
  Mono<Map<String, String>> csrf(ServerWebExchange exchange) {
    Mono<CsrfToken> token = exchange.getAttribute(CsrfToken.class.getName());
    return token.map(t -> Map.of("token", t.getToken(), "headerName", t.getHeaderName()));
  }

  @GetMapping("/api/v1/auth/me")
  Mono<sh.hades.daemon.community.CommunityApi.User> me(Mono<Principal> principal) {
    return principal.flatMap(p -> accounts.current(p.getName()));
  }

  public record Session(sh.hades.daemon.community.CommunityApi.User user) {}

  @GetMapping("/api/v1/auth/session")
  Mono<Session> session(Mono<Principal> principal) {
    return principal.flatMap(p -> accounts.current(p.getName())).map(Session::new).defaultIfEmpty(new Session(null));
  }

  @GetMapping("/health")
  Map<String, String> health() {
    return Map.of("status", "UP");
  }
}
