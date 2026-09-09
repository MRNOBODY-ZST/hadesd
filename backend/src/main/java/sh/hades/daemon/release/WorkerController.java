package sh.hades.daemon.release;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.Api.*;

@RestController
@RequestMapping("/api/v1/internal")
public class WorkerController {
  private final ReleaseService releases;

  public WorkerController(ReleaseService releases) {
    this.releases = releases;
  }

  @GetMapping("/retention")
  Mono<java.util.Map<String, java.util.List<String>>> retention() {
    return releases.retention();
  }

  @GetMapping("/snapshot/{id}")
  Mono<ReleaseSnapshot> snapshot(@PathVariable String id) {
    return releases.snapshot(id);
  }

  @PostMapping("/jobs/claim")
  Mono<ResponseEntity<PublishJob>> claim() {
    return releases
        .claim()
        .map(ResponseEntity::ok)
        .defaultIfEmpty(ResponseEntity.noContent().build());
  }

  @PostMapping("/jobs/{id}/heartbeat")
  Mono<ResponseEntity<Void>> heartbeat(
      @PathVariable String id, @Valid @RequestBody LeaseRequest input) {
    return releases
        .heartbeat(id, input.leaseToken())
        .thenReturn(ResponseEntity.noContent().build());
  }

  @PostMapping("/jobs/{id}/status")
  Mono<PublishJob> status(@PathVariable String id, @Valid @RequestBody StatusRequest input) {
    return releases.status(id, input);
  }
}
