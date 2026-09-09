package sh.hades.daemon.community;

import jakarta.validation.Valid;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.WebSession;
import reactor.core.publisher.Mono;
import sh.hades.daemon.community.CommunityApi.*;

@RestController
public class AccountController {
  private final AccountService accounts;
  public AccountController(AccountService accounts) { this.accounts = accounts; }

  @PostMapping("/api/v1/auth/register")
  @ResponseStatus(HttpStatus.CREATED)
  Mono<User> register(@Valid @RequestBody Register input) { return accounts.register(input); }

  @PutMapping("/api/v1/account/profile")
  Mono<User> profile(Principal principal, @Valid @RequestBody Profile input) {
    return accounts.profile(principal.getName(), input);
  }

  @PostMapping("/api/v1/account/password")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> password(Principal principal, @Valid @RequestBody Password input, WebSession session) {
    return accounts.password(principal.getName(), input).then(Mono.defer(session::invalidate));
  }
}
