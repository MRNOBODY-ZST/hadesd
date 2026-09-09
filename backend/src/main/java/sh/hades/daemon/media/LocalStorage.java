package sh.hades.daemon.media;

import java.nio.file.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import sh.hades.daemon.shared.Problem;

@Component
@ConditionalOnProperty(name = "hades.storage-mode", havingValue = "local", matchIfMissing = true)
public class LocalStorage implements StoragePort {
  private final Path root;

  public LocalStorage(@Value("${hades.media-root}") String root) {
    this.root = Path.of(root).toAbsolutePath().normalize();
  }

  private Path path(String key) {
    if (!key.matches("[0-9a-f-]{36}")) throw Problem.bad("INVALID_STORAGE_KEY", "存储标识无效");
    return root.resolve(key);
  }

  public Mono<Void> put(String key, byte[] bytes, String mime) {
    return Mono.fromCallable(
            () -> {
              Files.createDirectories(root);
              Files.write(path(key), bytes, StandardOpenOption.CREATE_NEW);
              return true;
            })
        .subscribeOn(Schedulers.boundedElastic())
        .then();
  }

  public Mono<byte[]> read(String key) {
    return Mono.fromCallable(
            () -> {
              Path p = path(key);
              if (Files.isSymbolicLink(p)) throw Problem.missing("附件不存在");
              return Files.readAllBytes(p);
            })
        .subscribeOn(Schedulers.boundedElastic());
  }

  public Mono<Boolean> exists(String key) {
    return Mono.fromCallable(() -> Files.isRegularFile(path(key), LinkOption.NOFOLLOW_LINKS))
        .subscribeOn(Schedulers.boundedElastic());
  }

  public Mono<Void> delete(String key) {
    return Mono.fromCallable(() -> Files.deleteIfExists(path(key)))
        .subscribeOn(Schedulers.boundedElastic())
        .then();
  }
}
