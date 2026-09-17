package sh.hades.daemon.shared;

import org.springframework.http.HttpStatus;

public class Problem extends RuntimeException {
  public final int status;
  public final String code;

  public Problem(int status, String code, String detail) {
    super(detail);
    this.status = status;
    this.code = code;
  }

  public static Problem bad(String code, String detail) {
    return new Problem(400, code, detail);
  }

  public static Problem missing(String detail) {
    return new Problem(404, "NOT_FOUND", detail);
  }

  public static Problem conflict(String code, String detail) {
    return new Problem(409, code, detail);
  }

  public record Body(
      String type, String title, int status, String detail, String code, String requestId) {}

  public Body body(String requestId) {
    return new Body(
        "urn:hadesd:problem:" + code.toLowerCase(java.util.Locale.ROOT),
        HttpStatus.valueOf(status).getReasonPhrase(),
        status,
        getMessage(),
        code,
        requestId);
  }
}
