package sh.hades.daemon.media;

import java.time.Duration;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;

/** Retries committed object deletions without blocking request or scheduler threads. */
@Component
public class MediaDeletionWorker {
  private final MediaService media;
  private Disposable subscription;
  public MediaDeletionWorker(MediaService media) { this.media=media; }
  @EventListener(ApplicationReadyEvent.class)
  public void start() {
    subscription=Flux.interval(Duration.ofSeconds(30),Duration.ofMinutes(1))
      .concatMap(tick->media.retryDeletes().onErrorComplete()).subscribe();
  }
  @PreDestroy public void stop() { if(subscription!=null) subscription.dispose(); }
}
