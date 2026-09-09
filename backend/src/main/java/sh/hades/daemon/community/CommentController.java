package sh.hades.daemon.community;

import jakarta.validation.Valid;
import java.security.Principal;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import reactor.core.publisher.Mono;
import sh.hades.daemon.community.CommunityApi.*;
import sh.hades.daemon.shared.Api.Page;

@RestController
public class CommentController {
  private final AccountService accounts;
  private final CommentService comments;
  public CommentController(AccountService accounts,CommentService comments) { this.accounts=accounts; this.comments=comments; }

  @GetMapping("/api/v1/public/contents/{id}/comments")
  Mono<Page<Comment>> list(@PathVariable String id,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) {
    return comments.publicComments(id,page,size);
  }

  @PostMapping("/api/v1/public/contents/{id}/comments")
  @ResponseStatus(HttpStatus.CREATED)
  Mono<Comment> create(Principal principal,@PathVariable String id,@Valid @RequestBody CreateComment input) {
    return accounts.current(principal.getName()).flatMap(user->comments.create(user.id(),id,input));
  }

  @GetMapping("/api/v1/account/comments")
  Mono<Page<Comment>> own(Principal principal,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) {
    return accounts.current(principal.getName()).flatMap(user->comments.ownComments(user.id(),page,size));
  }

  @PutMapping("/api/v1/account/comments/{id}")
  Mono<Comment> edit(Principal principal,@PathVariable String id,@Valid @RequestBody EditComment input) {
    return accounts.current(principal.getName()).flatMap(user->comments.edit(user.id(),id,input));
  }

  @DeleteMapping("/api/v1/account/comments/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> delete(Principal principal,@PathVariable String id) {
    return accounts.current(principal.getName()).flatMap(user->comments.delete(user.id(),id));
  }

  @GetMapping("/api/v1/admin/comments")
  Mono<Page<Comment>> admin(@RequestParam(required=false) String contentId,@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size) {
    return comments.adminComments(contentId,page,size);
  }

  @DeleteMapping("/api/v1/admin/comments/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  Mono<Void> moderate(@PathVariable String id) { return comments.delete(null,id); }
}
