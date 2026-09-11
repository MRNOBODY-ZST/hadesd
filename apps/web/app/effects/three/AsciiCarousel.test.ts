import { describe, expect, it } from "vitest";
import { createCarouselGeometry } from "./AsciiCarousel";

describe("shared cylinder tessellation", () => {
  it("preserves full-screen corners and UVs with fewer than 10,000 triangles for 80 panels", () => {
    for (const [width, height] of [[14.4, 9], [3.9, 8.44], [9, 9]]) {
      const geometry = createCarouselGeometry(width!, height!);
      const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
      expect(geometry.index!.count / 3 * 80).toBeLessThan(10_000);
      expect(position.count).toBe(66);
      for (let i = 0; i < position.count; i++) {
        expect(position.getX(i)).toBeCloseTo((uv.getX(i) - .5) * width!, 5);
        expect(position.getY(i)).toBeCloseTo((uv.getY(i) - .5) * height!, 5);
        expect(position.getZ(i)).toBe(0);
      }
      const radius = height! * 16 / (2 * Math.PI);
      // At the 32-row spacing, cylinder chord error is subpixel even on a 4K display.
      const maximumChordError = radius * (1 - Math.cos((2 * Math.PI / 16) / 64));
      expect(maximumChordError / height! * 2160).toBeLessThan(.11);
      geometry.dispose();
    }
  });
});
