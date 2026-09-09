package sh.hades.daemon.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.security.authentication.UserDetailsRepositoryReactiveAuthenticationManager;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.*;
import org.springframework.security.core.userdetails.*;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.server.*;
import org.springframework.security.web.server.authentication.*;
import org.springframework.security.web.server.context.NoOpServerSecurityContextRepository;
import org.springframework.security.web.server.csrf.WebSessionServerCsrfTokenRepository;
import org.springframework.security.web.server.savedrequest.NoOpServerRequestCache;
import org.springframework.security.web.server.util.matcher.ServerWebExchangeMatchers;
import org.springframework.session.data.redis.config.annotation.web.server.EnableRedisWebSession;
import org.springframework.web.server.session.*;
import reactor.core.scheduler.Schedulers;
import sh.hades.daemon.shared.Errors;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableWebFluxSecurity
@EnableRedisWebSession(maxInactiveIntervalInSeconds = 1800, redisNamespace = "hadesd:session")
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
public class SecurityConfig {
  @Bean
  PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder(12);
  }

  @Bean
  ReactiveUserDetailsService users(DatabaseClient db) {
    return username ->
        db.sql("SELECT username,password_hash,role FROM blog_account WHERE username=:username")
            .bind("username", username)
            .map(
                (r, m) ->
                    User.withUsername(r.get("username", String.class))
                        .password(r.get("password_hash", String.class))
                        .roles(r.get("role", String.class))
                        .build())
            .one();
  }

  @Bean
  UserDetailsRepositoryReactiveAuthenticationManager authManager(
      ReactiveUserDetailsService users, PasswordEncoder encoder) {
    var manager = new UserDetailsRepositoryReactiveAuthenticationManager(users);
    manager.setPasswordEncoder(encoder);
    manager.setScheduler(Schedulers.boundedElastic());
    return manager;
  }

  @Bean
  WebSessionIdResolver sessionCookie(@Value("${hades.session-secure}") boolean secure) {
    var resolver = new CookieWebSessionIdResolver();
    resolver.setCookieName("HADESD_SESSION");
    resolver.addCookieInitializer(
        c -> c.path("/api").httpOnly(true).secure(secure).sameSite("Strict"));
    return resolver;
  }

  @Bean
  @Order(0)
  SecurityWebFilterChain worker(
      ServerHttpSecurity http, @Value("${hades.worker-token}") String token, ObjectMapper json) {
    if (token.length() < 32)
      throw new IllegalArgumentException("WORKER_TOKEN must contain at least 32 characters");
    return http.securityMatcher(ServerWebExchangeMatchers.pathMatchers("/api/v1/internal/**"))
        .securityContextRepository(NoOpServerSecurityContextRepository.getInstance())
        .requestCache(c -> c.requestCache(NoOpServerRequestCache.getInstance()))
        .csrf(ServerHttpSecurity.CsrfSpec::disable)
        .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
        .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
        .logout(ServerHttpSecurity.LogoutSpec::disable)
        .addFilterAt(
            (exchange, chain) -> {
              String value = exchange.getRequest().getHeaders().getFirst("X-Worker-Token");
              if (value == null
                  || !MessageDigest.isEqual(
                      value.getBytes(StandardCharsets.UTF_8),
                      token.getBytes(StandardCharsets.UTF_8)))
                return Errors.write(
                    exchange, new Problem(401, "WORKER_UNAUTHORIZED", "Worker 凭据无效"), json);
              return chain.filter(exchange);
            },
            SecurityWebFiltersOrder.AUTHENTICATION)
        .authorizeExchange(e -> e.anyExchange().permitAll())
        .build();
  }

  @Bean
  @Order(1)
  SecurityWebFilterChain browser(
      ServerHttpSecurity http,
      UserDetailsRepositoryReactiveAuthenticationManager manager,
      ObjectMapper json,
      sh.hades.daemon.audit.AuditService audit) {
    return http.authenticationManager(manager)
        .requestCache(c -> c.requestCache(NoOpServerRequestCache.getInstance()))
        .authorizeExchange(
            e ->
                e.pathMatchers(org.springframework.http.HttpMethod.POST, "/api/v1/public/contents/*/comments")
                    .authenticated()
                    .pathMatchers(
                        "/api/v1/public/**", "/api/v1/auth/csrf", "/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/session", "/health")
                    .permitAll()
                    .pathMatchers("/api/v1/admin/**")
                    .hasRole("ADMIN")
                    .pathMatchers("/api/v1/account/**", "/api/v1/auth/me", "/api/v1/auth/logout")
                    .authenticated()
                    .anyExchange()
                    .denyAll())
        .exceptionHandling(
            e ->
                e.authenticationEntryPoint(
                        (ex, error) ->
                            Errors.write(ex, new Problem(401, "UNAUTHENTICATED", "请先登录"), json))
                    .accessDeniedHandler(
                        (ex, error) ->
                            Errors.write(
                                ex, new Problem(403, "ACCESS_DENIED", "无权访问或 CSRF 校验失败"), json)))
        .csrf(
            c ->
                c.csrfTokenRepository(new WebSessionServerCsrfTokenRepository())
                    .accessDeniedHandler(
                        (ex, error) ->
                            Errors.write(
                                ex, new Problem(403, "CSRF_INVALID", "CSRF 校验失败，请刷新令牌"), json)))
        .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
        .formLogin(
            f ->
                f.loginPage("/api/v1/auth/login")
                    .requiresAuthenticationMatcher(
                        ServerWebExchangeMatchers.pathMatchers(
                            org.springframework.http.HttpMethod.POST, "/api/v1/auth/login"))
                    .authenticationSuccessHandler(
                        (filter, auth) -> {
                          filter.getExchange().getResponse().setStatusCode(HttpStatus.OK);
                          return audit
                              .record("AUTH_LOGIN", auth.getName())
                              .then(filter.getExchange().getResponse().setComplete());
                        })
                    .authenticationFailureHandler(
                        (filter, error) ->
                            Errors.write(
                                filter.getExchange(),
                                new Problem(401, "INVALID_CREDENTIALS", "用户名或密码错误"),
                                json)))
        .logout(
            l ->
                l.requiresLogout(
                        ServerWebExchangeMatchers.pathMatchers(
                            org.springframework.http.HttpMethod.POST, "/api/v1/auth/logout"))
                    .logoutSuccessHandler(
                        (filter, auth) -> {
                          filter.getExchange().getResponse().setStatusCode(HttpStatus.NO_CONTENT);
                          return audit
                              .record("AUTH_LOGOUT", auth == null ? "anonymous" : auth.getName())
                              .then(filter.getExchange().getResponse().setComplete());
                        }))
        .headers(
            h ->
                h.contentTypeOptions(c -> {})
                    .referrerPolicy(
                        r ->
                            r.policy(
                                org.springframework.security.web.server.header
                                    .ReferrerPolicyServerHttpHeadersWriter.ReferrerPolicy
                                    .SAME_ORIGIN)))
        .build();
  }
}
