package sh.hades.daemon.release;

import java.util.List;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.search.SearchPort;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;

@RestController
@RequestMapping("/api/v1/public")
public class PublicController {
  private final ReleaseService releases;
  private final SearchPort search;

  public PublicController(ReleaseService releases, SearchPort search) {
    this.releases = releases;
    this.search = search;
  }

  @GetMapping("/release")
  Mono<ReleaseInfo> release() {
    return releases.info();
  }

  @GetMapping("/site")
  Mono<SiteSettings> site(@RequestParam(required = false) String releaseId) {
    return releases.active(releaseId).map(ReleaseSnapshot::site);
  }

  @GetMapping("/contents")
  Mono<Page<PublicContent>> list(
      @RequestParam(required = false) ContentType type,
      @RequestParam(required = false) String tag,
      @RequestParam(required = false) String releaseId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return releases
        .active(releaseId)
        .map(
            s ->
                Page.slice(
                    s.contents().stream()
                        .filter(c -> type == null || c.type() == type)
                        .filter(c -> tag == null || c.tags().contains(tag))
                        .toList(),
                    page,
                    size));
  }

  @GetMapping("/contents/{id}")
  Mono<PublicContent> content(
      @PathVariable String id, @RequestParam(required = false) String releaseId) {
    return releases
        .active(releaseId)
        .flatMap(
            s ->
                Mono.justOrEmpty(s.contents().stream().filter(c -> c.id().equals(id)).findFirst())
                    .switchIfEmpty(Mono.error(Problem.missing("公开内容不存在"))));
  }

  @GetMapping("/tags")
  Mono<List<String>> tags(@RequestParam(required = false) String releaseId) {
    return releases
        .active(releaseId)
        .map(
            s ->
                s.contents().stream().flatMap(c -> c.tags().stream()).distinct().sorted().toList());
  }

  @GetMapping("/search")
  Mono<Page<PublicContent>> search(
      @RequestParam(defaultValue = "") String q,
      @RequestParam(required = false) String releaseId,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return releases
        .active(releaseId)
        .flatMap(
            s ->
                search
                    .search(s, q, page, size)
                    .flatMap(results -> releases.active(s.releaseId()).thenReturn(results)));
  }
}
