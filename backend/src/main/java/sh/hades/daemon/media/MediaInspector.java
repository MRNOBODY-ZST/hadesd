package sh.hades.daemon.media;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import javax.imageio.ImageIO;
import sh.hades.daemon.shared.Problem;

/** Runs only on boundedElastic. Inspect image metadata before any full raster decode. */
public final class MediaInspector {
  private MediaInspector() {}

  public static String inspect(byte[] b) {
    String type;
    if (b.length >= 8
        && (b[0] & 255) == 137
        && text(b, 1, 3).equals("PNG")
        && b[4] == 13
        && b[5] == 10
        && b[6] == 26
        && b[7] == 10) type = "image/png";
    else if (b.length >= 3 && (b[0] & 255) == 255 && (b[1] & 255) == 216 && (b[2] & 255) == 255)
      type = "image/jpeg";
    else if (b.length >= 30 && text(b, 0, 4).equals("RIFF") && text(b, 8, 4).equals("WEBP"))
      type = "image/webp";
    else if (b.length >= 8 && text(b, 0, 5).equals("%PDF-")) type = "application/pdf";
    else throw new Problem(415, "UNSUPPORTED_MEDIA", "仅支持实际格式为 PNG、JPEG、WebP 或 PDF 的文件");
    int limit = type.equals("application/pdf") ? 25 * 1024 * 1024 : 10 * 1024 * 1024;
    if (b.length > limit) throw new Problem(413, "UPLOAD_TOO_LARGE", "图片上限 10 MiB，PDF 上限 25 MiB");
    if (type.equals("application/pdf")) return type;
    int width = 0, height = 0;
    try {
      if (type.equals("image/webp")) {
        String chunk = text(b, 12, 4);
        if (chunk.equals("VP8X")) {
          width = 1 + le24(b, 24);
          height = 1 + le24(b, 27);
        } else if (chunk.equals("VP8 ")
            && (b[23] & 255) == 157
            && (b[24] & 255) == 1
            && (b[25] & 255) == 42) {
          width = ((b[26] & 255) | ((b[27] & 255) << 8)) & 0x3fff;
          height = ((b[28] & 255) | ((b[29] & 255) << 8)) & 0x3fff;
        } else if (chunk.equals("VP8L") && (b[20] & 255) == 47) {
          width = 1 + ((b[21] & 255) | ((b[22] & 63) << 8));
          height = 1 + (((b[22] & 255) >> 6) | ((b[23] & 255) << 2) | ((b[24] & 15) << 10));
        }
      } else
        try (var stream = ImageIO.createImageInputStream(new ByteArrayInputStream(b))) {
          var readers = ImageIO.getImageReaders(stream);
          if (!readers.hasNext()) throw new IllegalArgumentException();
          var reader = readers.next();
          try {
            reader.setInput(stream);
            width = reader.getWidth(0);
            height = reader.getHeight(0);
          } finally {
            reader.dispose();
          }
        }
    } catch (Exception e) {
      throw new Problem(415, "INVALID_IMAGE", "图片格式损坏或无法读取尺寸");
    }
    if (width < 1
        || height < 1
        || width > 16000
        || height > 16000
        || (long) width * height > 40_000_000)
      throw new Problem(415, "IMAGE_DIMENSIONS", "图片尺寸无效或超过 4000 万像素");
    return type;
  }

  private static int le24(byte[] b, int i) {
    return (b[i] & 255) | ((b[i + 1] & 255) << 8) | ((b[i + 2] & 255) << 16);
  }

  private static String text(byte[] b, int offset, int length) {
    return new String(b, offset, length, StandardCharsets.US_ASCII);
  }
}
