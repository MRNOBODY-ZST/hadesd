package sh.hades.daemon.release;

import java.nio.file.*;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import sh.hades.daemon.shared.Problem;
import tools.jackson.databind.ObjectMapper;

/** The filesystem manifest is the only authority. No database flag may expose a release early. */
@Component
public class CurrentRelease {
  private final Path root;
  private final ObjectMapper json;

  public CurrentRelease(@Value("${hades.release-root}") String root, ObjectMapper json) {
    this.root = Path.of(root).toAbsolutePath().normalize();
    this.json = json;
  }

  public Mono<Optional<String>> id() {
    return Mono.fromCallable(
            () -> {
              Path current = root.resolve("current");
              if (!Files.exists(current, LinkOption.NOFOLLOW_LINKS))
                return Optional.<String>empty();
              Path real = current.toRealPath();
              if (!real.startsWith(root.resolve("releases").toRealPath()))
                throw new Problem(503, "INVALID_RELEASE_POINTER", "当前发布指针无效");
              var data = json.readTree(Files.readString(real.resolve("manifest.json")));
              String id = data.path("releaseId").asText();
              UUID.fromString(id);
              if (!real.getFileName().toString().equals(id)
                  || data.path("createdAt").asText().isBlank())
                throw new Problem(503, "INVALID_RELEASE_POINTER", "当前发布清单无效");
              return Optional.of(id);
            })
        .subscribeOn(Schedulers.boundedElastic())
        .onErrorMap(
            e -> e instanceof Problem ? e : new Problem(503, "RELEASE_UNAVAILABLE", "当前发布清单暂不可读"));
  }
}
