package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.Files;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;
import sh.hades.daemon.media.*;
import sh.hades.daemon.search.MySqlSearch;
import sh.hades.daemon.shared.Problem;

class MediaAndSearchTests {
  @Test
  void rejectsActiveUploadsAndOversizeImages() {
    for (String content :
        new String[] {
          "<svg onload='alert(1)'/>", "<html>evil</html>", "#!/bin/sh", "PK\u0003\u0004zip"
        })
      assertThatThrownBy(() -> MediaInspector.inspect(content.getBytes()))
          .isInstanceOf(Problem.class)
          .extracting(e -> ((Problem) e).status)
          .isEqualTo(415);
    byte[] png =
        Base64.getDecoder()
            .decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9p8AAAAASUVORK5CYII=");
    assertThat(MediaInspector.inspect(png)).isEqualTo("image/png");
    byte[] huge = new byte[10 * 1024 * 1024 + 1];
    System.arraycopy(png, 0, huge, 0, png.length);
    assertThatThrownBy(() -> MediaInspector.inspect(huge))
        .isInstanceOf(Problem.class)
        .extracting(e -> ((Problem) e).status)
        .isEqualTo(413);
  }

  @Test
  void localStorageIsRealImmutableAndRejectsTraversal() throws Exception {
    var storage = new LocalStorage(Files.createTempDirectory("hadesd-storage-test").toString());
    String id = java.util.UUID.randomUUID().toString();
    byte[] body = "actual contents".getBytes();
    storage.put(id, body, "application/pdf").block();
    assertThat(storage.read(id).block()).isEqualTo(body);
    assertThat(storage.exists(id).block()).isTrue();
    StepVerifier.create(storage.put(id, body, "application/pdf"))
        .expectError(java.nio.file.FileAlreadyExistsException.class)
        .verify();
    StepVerifier.create(storage.read("../../etc/passwd")).expectError(Problem.class).verify();
    storage.delete(id).block();
    assertThat(storage.exists(id).block()).isFalse();
  }

  @Test
  void shortAndPunctuationQueriesUseLiteralMetadata() {
    for (String q : new String[] {"系", "C++", "192.168.1.1", "\"word\"", "%"})
      assertThat(MySqlSearch.metadataOnly(q)).isTrue();
    assertThat(MySqlSearch.metadataOnly("系统")).isFalse();
    assertThat(MySqlSearch.like("50%_done!")).isEqualTo("%50!%!_done!!%");
  }

  @Test
  void rejectsAmbiguousTagPathsAndKeepsProgrammingNames() {
    for (String tag : new String[] {"a/b", "a\\b", "?q", "#tag", "%2F", ".", " .. "}) {
      assertThatThrownBy(() -> sh.hades.daemon.shared.Api.normalizeTags(java.util.List.of(tag)))
          .isInstanceOf(Problem.class);
    }
    assertThat(sh.hades.daemon.shared.Api.normalizeTags(java.util.List.of(" C++ ", "系统", "C++")))
        .containsExactly("C++", "系统");
  }
}
