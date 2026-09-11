package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.*;
import sh.hades.daemon.media.S3Storage;
import sh.hades.daemon.shared.Problem;
import software.amazon.awssdk.services.s3.model.S3Exception;

/** Exercises the real AWS client against HTTP responses without requiring Docker. */
class S3StorageProtocolTests {
  private HttpServer server;
  private S3Storage storage;
  private int status;

  @BeforeEach
  void start() throws Exception {
    System.setProperty("aws.accessKeyId", "protocol-test");
    System.setProperty("aws.secretAccessKey", "protocol-test-only");
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      exchange.sendResponseHeaders(status, -1);
      exchange.close();
    });
    server.start();
    storage = new S3Storage("test-media", "us-east-1",
        "http://127.0.0.1:" + server.getAddress().getPort(), true);
  }

  @AfterEach
  void stop() {
    storage.close();
    server.stop(0);
    System.clearProperty("aws.accessKeyId");
    System.clearProperty("aws.secretAccessKey");
  }

  @Test
  void absentObjectsAreFalseButDeniedAccessRemainsAnError() {
    status = 404;
    assertThat(storage.exists(UUID.randomUUID().toString()).block(Duration.ofSeconds(10))).isFalse();
    status = 403;
    assertThatThrownBy(() -> storage.exists(UUID.randomUUID().toString()).block(Duration.ofSeconds(10)))
        .isInstanceOf(S3Exception.class)
        .extracting(error -> ((S3Exception) error).statusCode()).isEqualTo(403);
  }

  @Test
  void missingDownloadBecomesAnApiNotFoundProblem() {
    status = 404;
    assertThatThrownBy(() -> storage.read(UUID.randomUUID().toString()).block(Duration.ofSeconds(10)))
        .isInstanceOf(Problem.class)
        .extracting(error -> ((Problem) error).status).isEqualTo(404);
  }

  @Test
  void allObjectOperationsRejectNonOpaqueKeysBeforeNetworkAccess() {
    status = 200;
    for (String key : new String[] {"../secret", "folder/key", "not-an-id"}) {
      assertThatThrownBy(() -> storage.read(key).block()).isInstanceOf(Problem.class);
      assertThatThrownBy(() -> storage.exists(key).block()).isInstanceOf(Problem.class);
      assertThatThrownBy(() -> storage.put(key, new byte[] {1}, "text/plain").block()).isInstanceOf(Problem.class);
      assertThatThrownBy(() -> storage.delete(key).block()).isInstanceOf(Problem.class);
    }
  }
}
