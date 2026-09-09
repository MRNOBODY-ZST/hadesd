package sh.hades.daemon.media;

import java.nio.charset.StandardCharsets;
import org.springframework.http.*;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.release.ReleaseService;
import sh.hades.daemon.shared.Api.*;
import sh.hades.daemon.shared.Problem;

@RestController
public class MediaController {
  private final MediaService media;
  private final ReleaseService releases;

  public MediaController(MediaService media, ReleaseService releases) {
    this.media = media;
    this.releases = releases;
  }

  @GetMapping("/api/v1/admin/media")
  Mono<Page<Media>> list(
      @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
    return media.list(page, size);
  }

  @PostMapping(value = "/api/v1/admin/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  Mono<Media> upload(@RequestPart("file") FilePart file) {
    return media.upload(file);
  }

  @GetMapping("/api/v1/admin/media/{id}/content")
  Mono<ResponseEntity<byte[]>> privateMedia(@PathVariable String id, @RequestParam(defaultValue = "false") boolean download) {
    return response(id, download);
  }

  @GetMapping("/api/v1/public/media/{id}")
  Mono<ResponseEntity<byte[]>> publicMedia(@PathVariable String id, @RequestParam(defaultValue = "false") boolean download) {
    return releases
        .active(null)
        .flatMap(
            s ->
                media
                    .isPublic(s.releaseId(), id)
                    .flatMap(ok -> ok ? response(id, download) : Mono.error(Problem.missing("公开附件不存在"))));
  }

  @DeleteMapping("/api/v1/admin/media/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> delete(@PathVariable String id) {
    return media.delete(id);
  }

  private Mono<ResponseEntity<byte[]>> response(String id, boolean download) {
    return media
        .get(id)
        .flatMap(
            m ->
                media
                    .bytes(id)
                    .map(
                        bytes -> {
                          var disposition =
                              download || !m.mime().startsWith("image/")
                                  ? ContentDisposition.attachment()
                                  : ContentDisposition.inline();
                          return ResponseEntity.ok()
                              .contentType(MediaType.parseMediaType(m.mime()))
                              .contentLength(m.size())
                              .header("X-Content-Type-Options", "nosniff")
                              .header("Content-Security-Policy", "default-src 'none'; sandbox")
                              .header(
                                  "Content-Disposition",
                                  disposition
                                      .filename(m.filename(), StandardCharsets.UTF_8)
                                      .build()
                                      .toString())
                              .header("Cache-Control", "no-store")
                              .body(bytes);
                        }));
  }
}
