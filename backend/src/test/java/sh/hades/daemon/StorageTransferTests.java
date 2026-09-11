package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import sh.hades.daemon.media.*;

class StorageTransferTests {
  @TempDir Path directory;
  private static final String KEY = "34f948ef-c908-445f-8098-e48cdeac66a9";
  private static final String HASH = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  private static final StorageTransfer.Item ITEM = new StorageTransfer.Item(KEY, "text/plain", 3, HASH);

  @Test
  void dryRunChecksSourceWithoutWritingAndApplyIsResumable() throws Exception {
    var source = new LocalStorage(directory.resolve("source").toString());
    var target = new LocalStorage(directory.resolve("target").toString());
    source.put(KEY, "abc".getBytes(), "text/plain").block();
    var dry = StorageTransfer.transfer(List.of(ITEM), source, target, false);
    assertThat(dry.pending()).isEqualTo(1);
    assertThat(dry.copied()).isZero();
    assertThat(target.exists(KEY).block()).isFalse();
    var applied = StorageTransfer.transfer(List.of(ITEM), source, target, true);
    assertThat(applied.copied()).isEqualTo(1);
    assertThat(applied.pending()).isZero();
    assertThat(target.read(KEY).block()).isEqualTo("abc".getBytes());
    assertThat(source.read(KEY).block()).isEqualTo("abc".getBytes());
    var repeated = StorageTransfer.transfer(List.of(ITEM), source, target, true);
    assertThat(repeated.copied()).isZero();
    assertThat(repeated.alreadyPresent()).isEqualTo(1);
  }

  @Test
  void rejectsCorruptSourceBeforeUploadingIt() {
    var source = new LocalStorage(directory.resolve("source").toString());
    var target = new LocalStorage(directory.resolve("target").toString());
    source.put(KEY, "bad".getBytes(), "text/plain").block();
    assertThatThrownBy(() -> StorageTransfer.transfer(List.of(ITEM), source, target, true))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("checksum");
    assertThat(target.exists(KEY).block()).isFalse();
  }

  @Test
  void neverOverwritesDifferentBytesAtTheSameDestinationKey() {
    var source = new LocalStorage(directory.resolve("source").toString());
    var target = new LocalStorage(directory.resolve("target").toString());
    source.put(KEY, "abc".getBytes(), "text/plain").block();
    target.put(KEY, "bad".getBytes(), "text/plain").block();
    assertThatThrownBy(() -> StorageTransfer.transfer(List.of(ITEM), source, target, true))
        .isInstanceOf(IllegalStateException.class).hasMessageContaining("Destination");
    assertThat(target.read(KEY).block()).isEqualTo("bad".getBytes());
  }

  @Test
  void legacyObjectsWithoutDatabaseHashAreComparedAndReported() throws Exception {
    var source = new LocalStorage(directory.resolve("source").toString());
    var target = new LocalStorage(directory.resolve("target").toString());
    source.put(KEY, "abc".getBytes(), "text/plain").block();
    var report = StorageTransfer.transfer(List.of(new StorageTransfer.Item(KEY, "text/plain", 3, null)), source, target, true);
    assertThat(report.legacyWithoutChecksum()).isEqualTo(1);
    assertThat(target.read(KEY).block()).isEqualTo("abc".getBytes());
  }
}
