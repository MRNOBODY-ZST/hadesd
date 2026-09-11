/** Mirror the authored left half exactly, including antialiased boundary pixels. */
export function mirrorMacFacePixels(pixels: Uint8ClampedArray, width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new RangeError("Mac artwork requires a complete positive RGBA raster.");
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < Math.floor(width / 2); x++) {
      const source = (y * width + x) * 4;
      const target = (y * width + width - x - 1) * 4;
      for (let channel = 0; channel < 4; channel++) pixels[target + channel] = pixels[source + channel]!;
    }
  }
}
