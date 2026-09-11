package sh.hades.daemon.media;

import java.net.URI;
import java.util.Locale;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.Errors;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

/** Public attachments remain readable by visitors, but cannot be embedded on another origin. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
public class PublicMediaGuard implements WebFilter {
  private final ObjectMapper json;

  public PublicMediaGuard(ObjectMapper json) {
    this.json = json;
  }

  public static boolean isPublicMedia(String path) {
    return path.startsWith("/api/v1/public/media/")
        || path.startsWith("/api/v1/public/comment-files/");
  }

  @Override
  public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
    if (!isPublicMedia(exchange.getRequest().getPath().value())) return chain.filter(exchange);
    var response = exchange.getResponse().getHeaders();
    response.set("Cross-Origin-Resource-Policy", "same-origin");
    response.set("X-Frame-Options", "DENY");
    response.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    // Live publication/comment permissions must be checked on every read, including at a CDN.
    response.setCacheControl("no-store");
    response.set("CDN-Cache-Control", "no-store");
    response.set("Cloudflare-CDN-Cache-Control", "no-store");
    if (isForeignEmbed(exchange.getRequest().getHeaders(), exchange.getRequest().getURI())) {
      return Errors.write(exchange,
          new Problem(403, "MEDIA_HOTLINK_BLOCKED", "请在本站文章中查看附件，不支持外站嵌入"), json);
    }
    return chain.filter(exchange);
  }

  private static boolean isForeignEmbed(HttpHeaders headers, URI origin) {
    // Opening an image/download as a document is useful to a reader and is not an embed.
    if ("navigate".equals(headers.getFirst("Sec-Fetch-Mode"))
        && "document".equals(headers.getFirst("Sec-Fetch-Dest"))) return false;
    String site = headers.getFirst("Sec-Fetch-Site");
    if ("cross-site".equals(site) || "same-site".equals(site)) return true;
    for (String name : new String[] {HttpHeaders.ORIGIN, HttpHeaders.REFERER}) {
      String value = headers.getFirst(name);
      if (value == null || value.isBlank()) continue;
      try {
        URI source = URI.create(value);
        if (source.getUserInfo() != null || source.getHost() == null
            || !normal(source.getScheme()).equals(normal(origin.getScheme()))
            || !normal(source.getHost()).equals(normal(origin.getHost()))
            || port(source) != port(origin)) return true;
      } catch (IllegalArgumentException error) {
        return true;
      }
    }
    // Direct links and older clients may omit metadata. CORP still blocks browser embedding.
    return false;
  }

  private static String normal(String value) {
    return value == null ? "" : value.toLowerCase(Locale.ROOT);
  }

  private static int port(URI uri) {
    return uri.getPort() >= 0 ? uri.getPort() : "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
  }
}
