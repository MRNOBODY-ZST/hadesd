import { describe, expect, it } from "vitest";
import { createBinaryStreamLayout } from "./binaryStreams";

describe("binary stream layout", () => {
  it("keeps the same seeded stream identities across rerenders and quality levels", () => {
    const desktop = createBinaryStreamLayout(48, 2026);
    expect(createBinaryStreamLayout(48, 2026)).toEqual(desktop);
    expect(createBinaryStreamLayout(24, 2026)).toEqual(desktop.slice(0, 24));
    expect(createBinaryStreamLayout(48, 2027)).not.toEqual(desktop);
  });

  it("bounds geometry and glyph counts while covering both sides and depths", () => {
    const streams = createBinaryStreamLayout(48);
    for (const stream of streams) {
      expect(stream.x).toBeGreaterThanOrEqual(-1.5);
      expect(stream.x).toBeLessThanOrEqual(1.5);
      expect(stream.y).toBeGreaterThanOrEqual(-1.2);
      expect(stream.y).toBeLessThanOrEqual(1.2);
      expect(stream.depth).toBeGreaterThanOrEqual(.5);
      expect(stream.depth).toBeLessThanOrEqual(4.5);
      expect(Number.isInteger(stream.characters)).toBe(true);
      expect(stream.characters).toBeGreaterThanOrEqual(8);
      expect(stream.characters).toBeLessThanOrEqual(24);
      expect(stream.seed).toBeGreaterThan(0);
    }
    expect(streams.filter(stream => stream.x < 0).length).toBeGreaterThan(12);
    expect(streams.filter(stream => stream.x > 0).length).toBeGreaterThan(12);
    expect(new Set(streams.map(stream => stream.seed)).size).toBe(48);
    expect(Math.max(...streams.map(stream => stream.depth)) - Math.min(...streams.map(stream => stream.depth))).toBeGreaterThan(3);
  });

  it("rejects unbounded or invalid instance allocations", () => {
    for (const count of [-1, .5, 129, NaN, Infinity]) {
      expect(() => createBinaryStreamLayout(count)).toThrow();
    }
    expect(createBinaryStreamLayout(0)).toEqual([]);
  });
});
