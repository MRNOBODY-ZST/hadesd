package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.net.URI;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.utility.DockerImageName;
import sh.hades.daemon.media.S3Storage;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

@Testcontainers
class S3StorageTests {
  @Container
  static GenericContainer<?> minio =
      new GenericContainer<>(DockerImageName.parse("minio/minio:RELEASE.2025-05-24T17-08-30Z"))
          .withEnv("MINIO_ROOT_USER", "hadesd-integration")
          .withEnv("MINIO_ROOT_PASSWORD", "integration-only-password")
          .withCommand("server", "/data")
          .withExposedPorts(9000);

  @Test
  void asynchronousS3ProtocolPersistsReadsAndDeletesPrivateObjects() {
    System.setProperty("aws.accessKeyId", "hadesd-integration");
    System.setProperty("aws.secretAccessKey", "integration-only-password");
    String endpoint = "http://" + minio.getHost() + ":" + minio.getMappedPort(9000),
        bucket = "integration-media";
    try (var admin =
            S3Client.builder()
                .endpointOverride(URI.create(endpoint))
                .region(Region.US_EAST_1)
                .forcePathStyle(true)
                .credentialsProvider(
                    StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(
                            "hadesd-integration", "integration-only-password")))
                .build();
        var storage = new S3Storage(bucket, "us-east-1", endpoint, true)) {
      admin.createBucket(b -> b.bucket(bucket));
      String key = UUID.randomUUID().toString();
      byte[] body = "real S3 protocol contents".getBytes();
      storage.put(key, body, "application/pdf").block();
      assertThat(storage.exists(key).block()).isTrue();
      assertThatThrownBy(() -> storage.put(key, "overwrite".getBytes(), "application/pdf").block())
          .isInstanceOf(software.amazon.awssdk.services.s3.model.S3Exception.class);
      assertThat(storage.read(key).block()).isEqualTo(body);
      storage.delete(key).block();
      assertThat(storage.exists(key).block()).isFalse();
    } finally {
      System.clearProperty("aws.accessKeyId");
      System.clearProperty("aws.secretAccessKey");
    }
  }
}
