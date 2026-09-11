package sh.hades.daemon.media;

import reactor.core.publisher.Mono;

/** Keys are opaque server-generated IDs, never client paths or URLs. */
public interface StoragePort {
  static String validKey(String key) {
    if (key == null || !key.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
      throw sh.hades.daemon.shared.Problem.bad("INVALID_STORAGE_KEY", "存储标识无效");
    return key;
  }

  Mono<Void> put(String key, byte[] bytes, String mime);

  Mono<byte[]> read(String key);

  Mono<Boolean> exists(String key);

  Mono<Void> delete(String key);
}
