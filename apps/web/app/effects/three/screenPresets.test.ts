import { describe, expect, it } from "vitest";
import { advanceScreenClock, createScreenOrder, screenFrameAt, SCREEN_PRESETS } from "./screenPresets";

describe("Mac screen playlist", () => {
  it("shuffles every preset once while introducing the real prompt first", () => {
    const order = createScreenOrder(42);
    expect(order[0]).toBe(0);
    expect(new Set(order).size).toBe(8);
    expect(order).toEqual(createScreenOrder(42));
    expect(order).not.toEqual(createScreenOrder(777));
  });

  it("reveals text monotonically without repainting or cutting off the longest screen", () => {
    for (const preset of SCREEN_PRESETS) {
      const index = SCREEN_PRESETS.indexOf(preset);
      const order = [index];
      let previous = -1;
      for (let time = 0; time < 8; time += .1) {
        const state = screenFrameAt(time, order);
        expect(state.reveal).toBeGreaterThanOrEqual(previous);
        previous = state.reveal;
      }
      expect(previous).toBeGreaterThanOrEqual((preset.lines.length - 1) * 60 + (preset.lines.at(-1)?.text.length ?? 0) - 1);
      expect(preset.lines.length).toBeLessThanOrEqual(18);
      expect(preset.lines.every(line => line.text.length <= 60)).toBe(true);
    }
  });

  it("selects every preset including the shared face and wraps at a complete cycle", () => {
    const order = createScreenOrder(42);
    expect(order.map((_, index) => screenFrameAt(index * 8 + 1, order).preset)).toEqual(order);
    expect(screenFrameAt(64, order).preset).toBe(0);
    expect(screenFrameAt(1, [7]).faceMix).toBe(1);
    expect(screenFrameAt(1, [0]).faceMix).toBe(0);
  });

  it("pauses invisible screens and recovers from an external clock reset", () => {
    const first = advanceScreenClock({ last: null, elapsed: 0 }, 100, true);
    expect(first.elapsed).toBe(0);
    const visible = advanceScreenClock(first, 100.1, true);
    expect(visible.elapsed).toBeCloseTo(.1);
    const hidden = advanceScreenClock(visible, 101, false);
    expect(hidden.elapsed).toBe(visible.elapsed);
    const reset = advanceScreenClock(hidden, 0, true);
    expect(advanceScreenClock(reset, .1, true).elapsed).toBeCloseTo(.2);
  });
});
