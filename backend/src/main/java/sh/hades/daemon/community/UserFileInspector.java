package sh.hades.daemon.community;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.zip.ZipInputStream;
import sh.hades.daemon.media.MediaInspector;
import sh.hades.daemon.shared.Problem;

/** Content inspection runs on boundedElastic; archives are never extracted or executed. */
public final class UserFileInspector {
  private UserFileInspector() {}
  private static final Set<String> TEXT = Set.of("txt", "md", "markdown", "csv", "json", "log", "yaml", "yml", "toml", "ini", "conf");

  public static String inspect(byte[] bytes, String filename) {
    if (bytes.length == 0) throw Problem.bad("EMPTY_UPLOAD", "上传文件为空");
    String name = filename.toLowerCase(Locale.ROOT);
    String extension = name.substring(name.lastIndexOf('.') + 1);
    if (Set.of("html", "htm", "xhtml", "svg", "svgz").contains(extension))
      throw unsupported();
    if (extension.equals("zip")) {
      if (bytes.length > 25 * 1024 * 1024) throw tooLarge();
      if (bytes.length < 22 || bytes[0] != 'P' || bytes[1] != 'K'
          || !((bytes[2] == 3 && bytes[3] == 4) || (bytes[2] == 5 && bytes[3] == 6))) throw unsupported();
      int end = -1;
      for (int i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
        if (bytes[i] == 'P' && bytes[i + 1] == 'K' && bytes[i + 2] == 5 && bytes[i + 3] == 6
            && i + 22 + unsignedShort(bytes, i + 20) == bytes.length) { end = i; break; }
      }
      if (end < 0 || unsignedShort(bytes, end + 4) != 0 || unsignedShort(bytes, end + 6) != 0
          || unsignedShort(bytes, end + 8) != unsignedShort(bytes, end + 10)
          || unsignedShort(bytes, end + 10) > 512) throw unsupported();
      final int expectedEntries = unsignedShort(bytes, end + 10);
      try (var archive = new ZipInputStream(new ByteArrayInputStream(bytes))) {
        int entries = 0;
        long expanded = 0;
        byte[] buffer = new byte[8192];
        for (var entry = archive.getNextEntry(); entry != null; entry = archive.getNextEntry()) {
          String path = entry.getName();
          if (++entries > 512 || path.startsWith("/") || path.contains("\\") || path.matches("^[A-Za-z]:.*")
              || Arrays.asList(path.split("/")).contains("..")) throw unsupported();
          int n;
          while ((n = archive.read(buffer)) != -1) {
            expanded += n;
            if (expanded > 100L * 1024 * 1024 || expanded > Math.max(1024 * 1024L, bytes.length * 100L))
              throw new Problem(413, "ARCHIVE_LIMIT", "压缩包展开体积或压缩率超过限制");
          }
        }
        if (entries != expectedEntries) throw unsupported();
      } catch (Problem problem) { throw problem; }
      catch (IOException error) { throw new Problem(415, "INVALID_ARCHIVE", "压缩包损坏或使用了不支持的加密方式"); }
      return "application/zip";
    }
    if (TEXT.contains(extension)) {
      if (bytes.length > 2 * 1024 * 1024) throw new Problem(413, "UPLOAD_TOO_LARGE", "文本文件上限 2 MiB");
      try {
        String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        if (text.codePoints().anyMatch(cp -> Character.isISOControl(cp) && cp != '\n' && cp != '\r' && cp != '\t')) throw unsupported();
        return "text/plain";
      } catch (CharacterCodingException error) { throw unsupported(); }
    }
    return MediaInspector.inspect(bytes);
  }

  private static int unsignedShort(byte[] bytes, int offset) {
    return (bytes[offset] & 255) | ((bytes[offset + 1] & 255) << 8);
  }

  private static Problem unsupported() { return new Problem(415, "UNSUPPORTED_MEDIA", "仅支持真实图片、PDF、UTF-8 文本或安全 ZIP；不支持 HTML/SVG"); }
  private static Problem tooLarge() { return new Problem(413, "UPLOAD_TOO_LARGE", "附件上限 25 MiB"); }
}
