package sh.hades.daemon.search;

import reactor.core.publisher.Mono;
import sh.hades.daemon.shared.Api.*;

public interface SearchPort {
  Mono<Page<PublicContent>> search(ReleaseSnapshot snapshot, String query, int page, int size);
}
