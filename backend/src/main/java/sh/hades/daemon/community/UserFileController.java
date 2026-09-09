package sh.hades.daemon.community;

import java.nio.charset.StandardCharsets;
import java.security.Principal;
import org.springframework.http.*;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.Api.*;

@RestController
public class UserFileController {
  private final AccountService accounts;
  private final UserFileService files;
  public UserFileController(AccountService accounts,UserFileService files) { this.accounts=accounts; this.files=files; }

  @GetMapping("/api/v1/account/files")
  Mono<Page<Media>> list(Principal principal,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) {
    return accounts.current(principal.getName()).flatMap(user->files.list(user.id(),page,size));
  }

  @PostMapping(value="/api/v1/account/files",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
  @ResponseStatus(HttpStatus.CREATED)
  Mono<Media> upload(Principal principal,@RequestPart("file") FilePart file) {
    return accounts.current(principal.getName()).flatMap(user->files.upload(user.id(),file));
  }

  @GetMapping("/api/v1/account/files/{id}/content")
  Mono<ResponseEntity<byte[]>> privateFile(Principal principal,@PathVariable String id,@RequestParam(defaultValue="false") boolean download) {
    return accounts.current(principal.getName()).flatMap(user->files.owned(user.id(),id)).flatMap(media->response(media,download));
  }

  @GetMapping("/api/v1/public/comment-files/{id}")
  Mono<ResponseEntity<byte[]>> publicFile(@PathVariable String id,@RequestParam(defaultValue="false") boolean download) {
    return files.publicFile(id).flatMap(media->response(media,download));
  }

  @DeleteMapping("/api/v1/account/files/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> delete(Principal principal,@PathVariable String id) {
    return accounts.current(principal.getName()).flatMap(user->files.delete(user.id(),id));
  }

  private Mono<ResponseEntity<byte[]>> response(Media media,boolean download) {
    return files.bytes(media.id()).map(bytes->{
      var disposition=!download && media.mime().startsWith("image/") ? ContentDisposition.inline() : ContentDisposition.attachment();
      return ResponseEntity.ok().contentType(MediaType.parseMediaType(media.mime())).contentLength(media.size())
          .header("Content-Disposition",disposition.filename(media.filename(),StandardCharsets.UTF_8).build().toString())
          .header("X-Content-Type-Options","nosniff").header("Content-Security-Policy","default-src 'none'; sandbox")
          .header("Cache-Control","no-store").body(bytes);
    });
  }
}
