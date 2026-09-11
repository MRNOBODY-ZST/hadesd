package sh.hades.daemon.media;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.Api.*;

@RestController
@RequestMapping("/api/v1/admin/media")
public class AdminMediaController {
  private final MediaService media;
  public AdminMediaController(MediaService media) { this.media=media; }

  @GetMapping
  Mono<Page<AdminMedia>> list(@RequestParam(defaultValue="0") int page,
      @RequestParam(defaultValue="20") int size, @RequestParam(defaultValue="") String q,
      @RequestParam(defaultValue="all") String type, @RequestParam(defaultValue="all") String referenced) {
    return media.listAdmin(page,size,q,type,referenced);
  }

  @GetMapping("/{id}/references")
  Mono<Page<MediaReference>> references(@PathVariable String id,
      @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="20") int size) {
    return media.references(id,page,size);
  }

  @PostMapping("/batch-delete")
  Mono<MediaBatchDeleteResult> delete(@Valid @RequestBody MediaBatchDelete input) {
    return media.batchDelete(input);
  }
}
