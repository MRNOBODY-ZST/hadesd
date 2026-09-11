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

function scrollFixture() {
  const surface = document.createElement("div"), transcript = document.createElement("div"), prompt = document.createElement("p");
  transcript.className = "terminal-transcript";
  transcript.style.cssText = "overflow:auto;color:rgb(200, 180, 100)";
  prompt.textContent = "guest@hadesd ~ %";
  surface.append(transcript, prompt); document.body.append(surface);
  type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number };
  const boxes = new WeakMap<Element, Box>();
  const bounds = (element: Element, top: number, height: number, width = 400) => boxes.set(element, { left: 0, top, width, height, right: width, bottom: top + height });
  bounds(surface, 0, 300); bounds(transcript, 40, 200); bounds(prompt, 250, 20);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return (boxes.get(this) || boxes.get(this.closest("[data-terminal-record]")!) || boxes.get(surface)!) as DOMRect;
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) { return [this.getBoundingClientRect()] as unknown as DOMRectList; });
  Object.defineProperties(Range.prototype, {
    getBoundingClientRect: { configurable: true, value: function (this: Range) { return (this.startContainer.nodeType === 3 ? this.startContainer.parentElement! : this.startContainer as Element).getBoundingClientRect(); } },
    getClientRects: { configurable: true, value: function (this: Range) { return [this.getBoundingClientRect()]; } },
  });
  let clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
  const stack: typeof clip[] = [], rects: { text?: string; color?: string; top: number; bottom: number; left: number; right: number }[] = [];
  let nextClip = clip;
  const ctx = {
    fillStyle: "", globalAlpha: 1,
    setTransform: vi.fn(), save: () => stack.push({ ...clip }), restore: () => { clip = stack.pop()!; },
    beginPath: vi.fn(), rect: (x: number, y: number, width: number, height: number) => { nextClip = { left: x, top: y, right: x + width, bottom: y + height }; },
    clip: () => { clip = { left: Math.max(clip.left, nextClip.left), top: Math.max(clip.top, nextClip.top), right: Math.min(clip.right, nextClip.right), bottom: Math.min(clip.bottom, nextClip.bottom) }; },
    roundRect: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(), setLineDash: vi.fn(),
    fillRect: (x: number, y: number, width: number, height: number) => rects.push({ color: ctx.fillStyle, left: Math.max(x, clip.left), top: Math.max(y, clip.top), right: Math.min(x + width, clip.right), bottom: Math.min(y + height, clip.bottom) }),
    fillText: (text: string) => rects.push({ text, ...clip }),
    measureText: () => ({ fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 2 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  return { surface, transcript, prompt, bounds, rects };
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

it("keeps new commands visible after large offscreen history and repaints when native scrolling reveals old records", async () => {
  const { surface, transcript, bounds, rects } = scrollFixture();
  const old = document.createElement("section"), recent = document.createElement("section");
  old.dataset.terminalRecord = "old"; recent.dataset.terminalRecord = "recent";
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 4_100; i++) { const line = document.createElement("span"); line.textContent = `old-${i}`; fragment.append(line); }
  old.append(fragment); recent.textContent = "CURRENT_COMMAND";
  bounds(old, -100_000, 90_000); bounds(recent, 100, 30);
  transcript.append(old, recent);
  const onUpdate = vi.fn(), capture = createTerminalSurface(surface, onUpdate);
  try {
    await flush();
    expect(rects.some(item => item.text === "CURRENT_COMMAND")).toBe(true);
    expect(rects.some(item => item.text === "guest@hadesd ~ %")).toBe(true);
    old.replaceChildren("OLDER_COMMAND"); bounds(old, 80, 30); bounds(recent, 500, 30);
    await Promise.resolve(); rects.length = 0;
    transcript.dispatchEvent(new Event("scroll")); transcript.dispatchEvent(new Event("scroll"));
    expect(frames.size).toBe(1);
    await flush();
    expect(rects.some(item => item.text === "OLDER_COMMAND")).toBe(true);
    expect(rects.some(item => item.text === "CURRENT_COMMAND")).toBe(false);
    expect(rects.some(item => item.text === "guest@hadesd ~ %")).toBe(true);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  } finally { capture.dispose(); }
});

it("clips selected history at the transcript boundary and leaves the native scrollbar gutter clear", async () => {
  const { surface, transcript, bounds, rects } = scrollFixture();
  const line = document.createElement("p"); line.textContent = "SELECTED_HISTORY"; transcript.append(line); bounds(line, 220, 70);
  Object.defineProperties(transcript, { clientWidth: { value: 388 }, clientHeight: { value: 200 }, scrollHeight: { value: 800 } });
  transcript.scrollTop = 600;
  const range = document.createRange(); range.selectNodeContents(line);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  const capture = createTerminalSurface(surface, vi.fn());
  try {
    await flush();
    const highlight = rects.find(item => item.color === "rgba(224, 188, 99, 0.2)");
    expect(highlight).toMatchObject({ top: 220, bottom: 240, left: 0, right: 388 });
    const ink = rects.find(item => item.text === "SELECTED_HISTORY");
    expect(ink).toMatchObject({ top: 40, bottom: 240, right: 388 });
    const thumb = rects.find(item => item.color === "rgb(200, 180, 100)");
    expect(thumb).toMatchObject({ left: 394, right: 400, top: 190, bottom: 240 });
  } finally { selection.removeAllRanges(); capture.dispose(); }
});

it("renders the visible tail of a long preformatted command without spending its ink budget on scrolled-away lines", async () => {
  const { surface, transcript, bounds, rects } = scrollFixture();
  const output = document.createElement("pre"), prefix = "OLD\n".repeat(8_000);
  output.style.whiteSpace = "pre-wrap";
  output.textContent = `${prefix}VISIBLE_END`;
  bounds(output, -100_000, 100_150); transcript.append(output);
  const text = output.firstChild!, hidden = { left: 0, top: -100, width: 100, height: 20, right: 100, bottom: -80 };
  const visible = { left: 0, top: 100, width: 110, height: 20, right: 110, bottom: 120 };
  let glyphMeasurements = 0;
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: function (this: Range) {
      if (this.startContainer !== text) return [this.startContainer.parentElement!.getBoundingClientRect()];
      return this.endOffset <= prefix.length ? [hidden] : this.startOffset < prefix.length ? [hidden, visible] : [visible];
    } },
    getBoundingClientRect: { configurable: true, value: function (this: Range) {
      if (this.startContainer !== text) return this.startContainer.parentElement!.getBoundingClientRect();
      glyphMeasurements++;
      if (this.startOffset < prefix.length) return hidden;
      const left = (this.startOffset - prefix.length) * 10;
      return { ...visible, left, right: left + 10, width: 10 };
    } },
  });
  const capture = createTerminalSurface(surface, vi.fn());
  try {
    await flush();
    expect(rects.some(item => item.text === "VISIBLE_END")).toBe(true);
    expect(rects.some(item => item.text === "guest@hadesd ~ %")).toBe(true);
    expect(glyphMeasurements).toBeLessThan(2_100);
  } finally { capture.dispose(); }
});
