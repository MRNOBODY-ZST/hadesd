import { describe, expect, it } from "vitest";
import { mirrorMacFacePixels } from "./macFaceSymmetry";

describe("Mac artwork symmetry", () => {
  it("mirrors every source pixel and alpha channel exactly, for both odd and even widths", () => {
    for (const width of [7, 8, 768]) {
      const height = 4;
      const pixels = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 73 + 17) % 256);
      const original = pixels.slice();
      mirrorMacFacePixels(pixels, width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < Math.ceil(width / 2); x++) {
          const source = (y * width + x) * 4;
          const mirrored = (y * width + width - 1 - x) * 4;
          expect(pixels.slice(source, source + 4)).toEqual(original.slice(source, source + 4));
          expect(pixels.slice(mirrored, mirrored + 4)).toEqual(original.slice(source, source + 4));
        }
      }
    }
  });

  it("preserves source ink under repeated processing", () => {
    const pixels = Uint8ClampedArray.from([10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 128, 1, 2, 3, 4]);
    mirrorMacFacePixels(pixels, 4, 1);
    const symmetric = pixels.slice();
    mirrorMacFacePixels(pixels, 4, 1);
    expect(pixels).toEqual(symmetric);
    expect(pixels.slice(8, 12)).toEqual(Uint8ClampedArray.from([40, 50, 60, 0]));
  });

  it("rejects malformed raster dimensions before modifying artwork", () => {
    const pixels = new Uint8ClampedArray(16);
    for (const [width, height] of [[0, 1], [2.5, 1], [2, -1], [3, 2]]) {
      expect(() => mirrorMacFacePixels(pixels, width!, height!)).toThrow(RangeError);
    }
  });
});
