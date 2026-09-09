import { createPortal } from "react-dom";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { measureNativeImage, NativeImageLayer } from "./NativeImageLayer";

type Bounds = { left: number; top: number; width: number; height: number };
function bounds(element: Element, value: Bounds) {
  Object.defineProperty(element, "getBoundingClientRect", { configurable: true, value: () => ({
    ...value, x: value.left, y: value.top, right: value.left + value.width, bottom: value.top + value.height, toJSON() { return {}; },
  }) });
}
function fixture() {
  const stage = document.createElement("div"), surface = document.createElement("div"), clip = document.createElement("div"), image = document.createElement("img");
  stage.append(surface); surface.append(clip); clip.append(image); document.body.append(stage);
  bounds(stage, { left: 10, top: 20, width: 500, height: 400 });
  bounds(surface, { left: 30, top: 50, width: 400, height: 300 });
  bounds(clip, { left: 50, top: 80, width: 200, height: 160 });
  bounds(image, { left: 40, top: 60, width: 300, height: 200 });
  surface.style.cssText = "overflow:hidden;opacity:0";
  clip.style.cssText = "overflow:hidden;opacity:.75";
  image.style.cssText = "object-fit:cover;object-position:25% 75%;border-radius:12px";
  image.src = "https://images.example.test/picture.png";
  Object.defineProperties(image, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: 600 }, naturalHeight: { configurable: true, value: 400 } });
  return { stage, surface, clip, image };
}
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const observers: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; notify: () => void }[] = [];
beforeEach(() => {
  frames = new Map(); nextFrame = 0; observers.length = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal("ResizeObserver", class {
    observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); notify: () => void;
    constructor(callback: () => void) { this.notify = callback; observers.push(this); }
  });
});
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush() {
  await act(async () => {});
  const pending = [...frames.values()]; frames.clear();
  await act(async () => { for (const callback of pending) callback(0); });
}

it("aligns native images to the stage and clips their original geometry at every terminal viewport", () => {
  const { stage, surface, clip, image } = fixture();
  clip.style.border = "5px solid transparent";
  const native = measureNativeImage(image, surface, stage);
  expect(native).toMatchObject({
    src: image.src, left: 45, top: 65, width: 190, height: 150,
    imageLeft: -15, imageTop: -25, imageWidth: 300, imageHeight: 200,
    objectFit: "cover", objectPosition: "25% 75%", borderRadius: "12px", opacity: .75,
  });
  image.style.opacity = "0.5";
  expect(measureNativeImage(image, surface, stage)?.opacity).toBe(.375);
});

it("omits unrevealed, failed, out-of-page and unsupported-origin images", () => {
  const { stage, surface, clip, image } = fixture();
  clip.style.visibility = "hidden";
  expect(measureNativeImage(image, surface, stage)).toBeNull();
  clip.style.visibility = "visible";
  clip.style.opacity = "0";
  expect(measureNativeImage(image, surface, stage)).toBeNull();
  clip.style.opacity = "1";
  bounds(image, { left: 40, top: 400, width: 300, height: 200 });
  expect(measureNativeImage(image, surface, stage)).toBeNull();
  bounds(image, { left: 40, top: 60, width: 300, height: 200 });
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 0 });
  expect(measureNativeImage(image, surface, stage)).toBeNull();
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: 600 });
  for (const source of ["http://images.example.test/picture.png", "/local.png", "data:image/png;base64,AAAA", "blob:https://images.example.test/id"]) {
    image.src = source;
    expect(measureNativeImage(image, surface, stage), source).toBeNull();
  }
});

it("coalesces layout events, updates paged image positions and schedules no idle loop", async () => {
  const { stage, surface, clip, image } = fixture();
  render(createPortal(<NativeImageLayer surface={surface} />, stage));
  await flush();
  const layer = stage.querySelector("[data-native-image-layer]")!;
  expect(layer.getAttribute("data-native-image-count")).toBe("1");
  const native = layer.querySelector("img")!;
  expect(native.getAttribute("referrerpolicy")).toBe("no-referrer");
  expect(layer.getAttribute("aria-hidden")).toBe("true");
  expect(native.hasAttribute("crossorigin")).toBe(false);
  expect(native.style.left).toBe("-10px");
  expect(frames.size).toBe(0);
  bounds(image, { left: 70, top: 100, width: 100, height: 80 });
  fireEvent.scroll(clip); fireEvent.load(image); observers[0]!.notify();
  image.className = "loaded-photo";
  await act(async () => {});
  expect(frames.size).toBe(1);
  await flush();
  expect((layer.firstElementChild as HTMLElement).style.left).toBe("60px");
  expect(native.style.left).toBe("0px");
  expect(frames.size).toBe(0);
  image.remove();
  await flush();
  expect(layer.getAttribute("data-native-image-count")).toBe("0");
  expect(observers[0]!.unobserve).toHaveBeenCalledWith(image);
  expect(frames.size).toBe(0);
});

it("cancels pending work and removes observers/listeners when graphics are disabled", async () => {
  const { stage, surface, image } = fixture();
  const mounted = render(createPortal(<NativeImageLayer surface={surface} />, stage));
  expect(frames.size).toBe(1);
  mounted.unmount();
  expect(frames.size).toBe(0);
  expect(observers[0]!.disconnect).toHaveBeenCalledOnce();
  fireEvent.load(image); fireEvent.scroll(surface); fireEvent(window, new Event("resize"));
  surface.className = "changed-after-unmount";
  await act(async () => {});
  expect(frames.size).toBe(0);
});

it("shows only a closed details summary image and updates body images through open and close", async () => {
  const { stage, surface, clip, image } = fixture();
  const details = document.createElement("details"), summary = document.createElement("summary");
  summary.textContent = "展开图片";
  details.append(summary); clip.replaceWith(details); details.append(clip);
  // Hidden details descendants still have nonzero browser layout boxes.
  bounds(details, { left: 30, top: 50, width: 400, height: 300 });
  render(createPortal(<NativeImageLayer surface={surface} />, stage));
  await flush();
  const layer = stage.querySelector("[data-native-image-layer]")!;
  expect(layer.getAttribute("data-native-image-count")).toBe("0");
  details.open = true;
  await flush();
  expect(layer.getAttribute("data-native-image-count")).toBe("1");
  details.open = false;
  fireEvent(details, new Event("toggle"));
  await flush();
  expect(layer.getAttribute("data-native-image-count")).toBe("0");
  summary.append(image);
  await flush();
  expect(layer.getAttribute("data-native-image-count")).toBe("1");
});
