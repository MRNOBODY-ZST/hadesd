import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBootTexture, createMacScreenTexture } from "./introTextures";

const fillText = vi.fn();
beforeEach(() => {
  fillText.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    fillRect() {}, clearRect() {}, strokeRect() {}, fillText,
    save() {}, restore() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    measureText(text: string) { return { width: text.length * 12 }; },
  }) as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

it("updates independent boot/loading uniforms without repainting any text", () => {
  const boot = createBootTexture();
  const count = fillText.mock.calls.length, version = boot.texture.version;
  boot.paint(0, "boot", .03);
  expect(boot.sequence.value).toBe(.03);
  for (let i = 0; i <= 1000; i++) boot.paint(i / 1000, "boot", i / 1000);
  expect(fillText.mock.calls.length).toBe(count);
  expect(boot.texture.version).toBe(version);
  boot.paint(.9, "resume", .5);
  expect(boot.sequence.value).toBe(1);
  expect(boot.progress.value).toBe(.9);
  boot.dispose();
});

it("animates a complete preset cycle using uniforms and one immutable atlas", () => {
  const screen = createMacScreenTexture();
  const count = fillText.mock.calls.length, version = screen.texture.version;
  for (let i = 0; i < 4800; i++) screen.update(i / 60, true);
  expect(fillText.mock.calls.length).toBe(count);
  expect(screen.texture.version).toBe(version);
  expect(screen.uniforms.preset.value).toBeGreaterThanOrEqual(0);
  expect(screen.uniforms.preset.value).toBeLessThan(8);
  screen.dispose();
});
