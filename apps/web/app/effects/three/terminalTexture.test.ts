import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTerminalSurface } from "./terminalTexture";

let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const rangeMethods = ["getBoundingClientRect", "getClientRects"] as const;
const originalRangeMethods = rangeMethods.map(name => Object.getOwnPropertyDescriptor(Range.prototype, name));
beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  rangeMethods.forEach((name, index) => {
    const original = originalRangeMethods[index];
    if (original) Object.defineProperty(Range.prototype, name, original);
    else Reflect.deleteProperty(Range.prototype, name);
  });
});
async function flush() {
  await Promise.resolve();
  const pending = [...frames.values()]; frames.clear();
  for (const frame of pending) frame(0);
}

it("captures closed/open/closed details like the browser, even when hidden descendants retain layout boxes", async () => {
  const box = { left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}) };
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(box);
  vi.spyOn(Element.prototype, "getClientRects").mockReturnValue([box] as unknown as DOMRectList);
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: () => box },
    getClientRects: { configurable: true, value: () => [box] },
  });
  const ink: string[] = [];
  const ctx = {
    setTransform: vi.fn(), fillRect: () => { ink.length = 0; }, save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), roundRect: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(), setLineDash: vi.fn(),
    fillText: (text: string) => ink.push(text), measureText: () => ({ fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 2 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const surface = document.createElement("div"), details = document.createElement("details");
  const summary = document.createElement("summary"), body = document.createElement("p"), secondSummary = document.createElement("summary");
  summary.textContent = "VISIBLE_SUMMARY"; body.textContent = "HIDDEN_BODY"; secondSummary.textContent = "SECOND_SUMMARY";
  details.append(summary, body, secondSummary); surface.append(details); document.body.append(surface);
  const onUpdate = vi.fn(), capture = createTerminalSurface(surface, onUpdate);
  try {
    await flush();
    expect(ink).toContain("VISIBLE_SUMMARY");
    expect(ink).not.toContain("HIDDEN_BODY");
    expect(ink).not.toContain("SECOND_SUMMARY");
    details.open = true;
    await flush();
    expect(ink).toContain("HIDDEN_BODY");
    expect(ink).toContain("SECOND_SUMMARY");
    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    await flush();
    expect(ink).toEqual(["VISIBLE_SUMMARY"]);
    expect(onUpdate.mock.calls.length).toBeGreaterThanOrEqual(3);
  } finally { capture.dispose(); }
});
