import { describe, expect, it } from "vitest";
import { macFaceUvScale } from "./screenProjection";

const screen = { width: 2.7, height: 2.05 };
const viewports = [[1440, 900], [390, 844], [900, 900], [2560, 1080]] as const;

describe("Mac screen to cylinder image projection", () => {
  it("keeps the source image square on the physical screen throughout the zoom", () => {
    for (const [width, height] of viewports) {
      const fullScale = Math.max(width / screen.width, height / screen.height) * 1.025;
      const fitX = Math.max(width / height, 1), fitY = Math.max(height / width, 1);
      for (const framed of [0, .05, .25, .5, .75, 1]) {
        const [x, y] = macFaceUvScale(screen.width, screen.height, width, height, fullScale, framed);
        // A unit square in the source must cover equal physical distances.
        const imageWidth = screen.width / (x * fitX);
        const imageHeight = screen.height / (y * fitY);
        expect(imageWidth / imageHeight).toBeCloseTo(1, 12);
      }
    }
  });

  it("samples identical UVs on the last Mac frame and first flat cylinder frame", () => {
    for (const [width, height] of viewports) {
      const fullScale = Math.max(width / screen.width, height / screen.height) * 1.025;
      const [x, y] = macFaceUvScale(screen.width, screen.height, width, height, fullScale, 0);
      for (const [u, v] of [[.1, .1], [.5, .5], [.9, .9], [.2, .8]]) {
        const worldX = (u! - .5) * width, worldY = (v! - .5) * height;
        const macU = worldX / (screen.width * fullScale) + .5;
        const macV = worldY / (screen.height * fullScale) + .5;
        expect((macU - .5) * x + .5).toBeCloseTo(u!, 12);
        expect((macV - .5) * y + .5).toBeCloseTo(v!, 12);
      }
    }
  });
});
