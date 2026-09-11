package sh.hades.daemon.content;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.release.ReleaseService;
import sh.hades.daemon.settings.SettingsService;
import sh.hades.daemon.shared.Api.*;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {
  private final ContentService contents;
  private final ReleaseService releases;
  private final SettingsService settings;

  public AdminController(
      ContentService contents, ReleaseService releases, SettingsService settings) {
    this.contents = contents;
    this.releases = releases;
    this.settings = settings;
  }

  @GetMapping("/contents")
  Mono<Page<Content>> list(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size,
      @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "all") String type,
      @RequestParam(defaultValue = "false") boolean trash) {
    return contents.list(page, size, q, type, trash);
  }

  @PostMapping("/contents")
  @ResponseStatus(HttpStatus.CREATED)
  Mono<Content> create(@Valid @RequestBody CreateContent input) {
    return contents.create(input);
  }

  @GetMapping("/contents/{id}")
  Mono<Content> get(@PathVariable String id) {
    return contents.get(id);
  }

  @DeleteMapping("/contents/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> delete(@PathVariable String id, @RequestParam long version) {
    return contents.delete(id, version);
  }

  @DeleteMapping("/contents/{id}/purge")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> purge(@PathVariable String id,@RequestParam long version) {
    return contents.purge(id,version);
  }

  @PostMapping("/contents/{id}/restore")
  Mono<Content> restore(@PathVariable String id, @Valid @RequestBody ContentVersion input) {
    return contents.restore(id, input.version());
  }

  @PostMapping("/contents/{id}/revisions")
  Mono<Content> save(@PathVariable String id, @Valid @RequestBody SaveRevision input) {
    return contents.save(id, input);
  }

  @GetMapping("/contents/{id}/revisions")
  Mono<Page<Revision>> history(
      @PathVariable String id,
      @RequestParam(defaultValue = "0") int page,
      @RequestParam(defaultValue = "20") int size) {
    return contents.revisions(id, page, size);
  }

  @GetMapping("/contents/{id}/revisions/{rid}")
  Mono<Revision> revision(@PathVariable String id, @PathVariable String rid) {
    return contents.revision(id, rid);
  }

  @GetMapping("/settings")
  Mono<SiteSettings> settings() {
    return settings.get();
  }

  @PutMapping("/settings")
  Mono<SiteSettings> settings(@Valid @RequestBody SiteSettings input) {
    return settings.save(input);
  }

  @PostMapping("/publish-jobs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  Mono<PublishJob> publish(@Valid @RequestBody PublishRequest input) {
    return releases.create(input);
  }

  @GetMapping("/publish-jobs/{id}")
  Mono<PublishJob> job(@PathVariable String id) {
    return releases.reconcile().then(releases.job(id));
  }

  @GetMapping("/releases")
  Mono<Page<Release>> releases(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return releases.releases(page, size);
  }

  @PostMapping("/releases/{id}/rollback-jobs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  Mono<PublishJob> rollback(@PathVariable String id) {
    return releases.create(new PublishRequest(Operation.ROLLBACK, null, null, id));
  }
}
