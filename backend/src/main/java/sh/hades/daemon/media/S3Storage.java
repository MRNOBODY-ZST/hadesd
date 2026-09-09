package sh.hades.daemon.media;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Mono;
import software.amazon.awssdk.core.async.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.*;
import software.amazon.awssdk.services.s3.model.*;

@Component
@ConditionalOnProperty(name = "hades.storage-mode", havingValue = "s3")
public class S3Storage implements StoragePort, AutoCloseable {
  private final S3AsyncClient client;
  private final String bucket;

  public S3Storage(
      @Value("${hades.s3.bucket}") String bucket,
      @Value("${hades.s3.region}") String region,
      @Value("${hades.s3.endpoint}") String endpoint,
      @Value("${hades.s3.path-style}") boolean pathStyle) {
    if (bucket.isBlank())
      throw new IllegalArgumentException("S3_BUCKET is required for S3 storage");
    this.bucket = bucket;
    var builder =
        S3AsyncClient.builder()
            .region(Region.of(region))
            .serviceConfiguration(
                S3Configuration.builder().pathStyleAccessEnabled(pathStyle).build());
    if (!endpoint.isBlank()) builder.endpointOverride(URI.create(endpoint));
    client = builder.build();
  }

  public Mono<Void> put(String key, byte[] bytes, String mime) {
    return Mono.fromFuture(
            () ->
                client.putObject(
                    PutObjectRequest.builder()
                        .bucket(bucket)
                        .key(key)
                        .contentType(mime)
                        .ifNoneMatch("*")
                        .build(),
                    AsyncRequestBody.fromBytes(bytes)))
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .then();
  }

  public Mono<byte[]> read(String key) {
    return Mono.fromFuture(
            () ->
                client.getObject(
                    GetObjectRequest.builder().bucket(bucket).key(key).build(),
                    AsyncResponseTransformer.toBytes()))
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .map(b -> b.asByteArray());
  }

  public Mono<Boolean> exists(String key) {
    return Mono.fromFuture(
            () -> client.headObject(HeadObjectRequest.builder().bucket(bucket).key(key).build()))
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .map(r -> true)
        .onErrorResume(NoSuchKeyException.class, e -> Mono.just(false));
  }

  public Mono<Void> delete(String key) {
    return Mono.fromFuture(
            () ->
                client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build()))
        .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
        .then();
  }

  public void close() {
    client.close();
  }
}
