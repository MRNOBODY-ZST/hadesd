package sh.hades.daemon;

import static org.assertj.core.api.Assertions.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import org.junit.jupiter.api.Test;
import sh.hades.daemon.community.UserFileInspector;
import sh.hades.daemon.shared.Problem;

class UserFileInspectorTests {
  static byte[] zip(String name,byte[] bytes) throws IOException {
    var buffer=new ByteArrayOutputStream();
    try(var archive=new ZipOutputStream(buffer)) { archive.putNextEntry(new ZipEntry(name)); archive.write(bytes); archive.closeEntry(); }
    return buffer.toByteArray();
  }
  @Test void supportsUtf8TextAndZipWithoutTrustingTheSuppliedMime() throws Exception {
    assertThat(UserFileInspector.inspect("正文\nSource".getBytes(StandardCharsets.UTF_8),"说明.md")).isEqualTo("text/plain");
    assertThat(UserFileInspector.inspect(zip("source.txt","Source".getBytes()),"source.zip")).isEqualTo("application/zip");
    assertThatThrownBy(()->UserFileInspector.inspect(new byte[]{(byte)0xff},"invalid.txt")).isInstanceOf(Problem.class);
    assertThatThrownBy(()->UserFileInspector.inspect(new byte[]{0,1,2},"binary.md")).isInstanceOf(Problem.class);
  }
  @Test void blocksActiveFormatsTraversalArchivesAndDecompressionBombs() throws Exception {
    for(String filename:new String[]{"payload.html","payload.svg","pretend.png"})
      assertThatThrownBy(()->UserFileInspector.inspect("<svg onload='alert(1)'/>".getBytes(),filename)).isInstanceOf(Problem.class);
    byte[] malformed = new byte[22]; malformed[0]='P'; malformed[1]='K'; malformed[2]=3; malformed[3]=4;
    assertThatThrownBy(()->UserFileInspector.inspect(malformed,"truncated.zip")).isInstanceOf(Problem.class);
    assertThatThrownBy(()->UserFileInspector.inspect(zip("../../outside.txt","x".getBytes()),"traversal.zip")).isInstanceOf(Problem.class);
    assertThatThrownBy(()->UserFileInspector.inspect(zip("large.txt",new byte[2*1024*1024]),"bomb.zip")).isInstanceOf(Problem.class).extracting(e->((Problem)e).code).isEqualTo("ARCHIVE_LIMIT");
  }
  @Test void appliesTextByteLimitAndRejectsEmptyUploads() {
    assertThatThrownBy(()->UserFileInspector.inspect(new byte[2*1024*1024+1],"large.txt")).isInstanceOf(Problem.class).extracting(e->((Problem)e).status).isEqualTo(413);
    assertThatThrownBy(()->UserFileInspector.inspect(new byte[0],"empty.txt")).isInstanceOf(Problem.class).extracting(e->((Problem)e).code).isEqualTo("EMPTY_UPLOAD");
  }
}
