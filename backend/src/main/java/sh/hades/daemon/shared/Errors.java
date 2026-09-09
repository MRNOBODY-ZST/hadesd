package sh.hades.daemon.shared;

import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;
import tools.jackson.databind.ObjectMapper;

@Component
@Order(-2)
public class Errors implements WebExceptionHandler {
  private final ObjectMapper json;

  public Errors(ObjectMapper json) {
    this.json = json;
  }

  @Override
  public Mono<Void> handle(ServerWebExchange ex, Throwable e) {
    if (ex.getResponse().isCommitted()) return Mono.error(e);
    Problem p =
        e instanceof Problem x
            ? x
            : e instanceof org.springframework.dao.DataIntegrityViolationException
                ? Problem.conflict("DATA_CONFLICT", "记录存在关联或唯一性冲突，请刷新后重试")
                : e instanceof WebExchangeBindException
                    ? Problem.bad("VALIDATION_FAILED", "请检查必填字段、长度与 slug 格式")
                    : e instanceof DataBufferLimitException
                        ? new Problem(413, "UPLOAD_TOO_LARGE", "请求超过大小限制")
                        : e instanceof ResponseStatusException x
                            ? new Problem(x.getStatusCode().value(), "INVALID_REQUEST", "请求无法处理")
                            : new Problem(503, "SERVICE_UNAVAILABLE", "服务暂不可用，请稍后重试");
    if (!(e instanceof Problem
        || e instanceof WebExchangeBindException
        || e instanceof ResponseStatusException
        || e instanceof DataBufferLimitException))
      org.slf4j.LoggerFactory.getLogger(Errors.class)
          .warn("Request {} failed: {}", ex.getRequest().getId(), e.getClass().getSimpleName());
    return write(ex, p, json);
  }

  public static Mono<Void> write(ServerWebExchange ex, Problem p, ObjectMapper json) {
    ex.getResponse().setStatusCode(org.springframework.http.HttpStatusCode.valueOf(p.status));
    ex.getResponse().getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
    ex.getResponse().getHeaders().setCacheControl("no-store");
    return ex.getResponse()
        .writeWith(
            Mono.just(
                ex.getResponse()
                    .bufferFactory()
                    .wrap(json.writeValueAsBytes(p.body(ex.getRequest().getId())))));
  }
}
