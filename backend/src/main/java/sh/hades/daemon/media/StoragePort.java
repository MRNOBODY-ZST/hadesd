package sh.hades.daemon.media;

import reactor.core.publisher.Mono;

/** Keys are opaque server-generated IDs, never client paths or URLs. */
public interface StoragePort {
  Mono<Void> put(String key, byte[] bytes, String mime);

  Mono<byte[]> read(String key);

  Mono<Boolean> exists(String key);

  Mono<Void> delete(String key);
}
