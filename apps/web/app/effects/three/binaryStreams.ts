export interface BinaryStream {
  /** Viewport-relative lane center; the vertex shader resolves perspective. */
  x: number;
  y: number;
  depth: number;
  characters: number;
  seed: number;
}

/** Stable prefixes let portrait screens draw fewer instances without reshuffling. */
export function createBinaryStreamLayout(count = 48, seed = 0x48414445): BinaryStream[] {
  if (!Number.isInteger(count) || count < 0 || count > 128) {
    throw new RangeError("Binary stream count must be an integer from 0 to 128.");
  }
  let state = seed >>> 0;
  const random = () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, state | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => ({
    // Interleave opposite sides so reduced instance counts keep the composition.
    x: (index % 2 ? 1 : -1) * (.12 + random() * 1.32),
    y: (random() - .5) * 2.3,
    depth: .5 + random() * 4,
    characters: 8 + Math.floor(random() * 17),
    seed: index + 1 + random() * .9,
  }));
}
