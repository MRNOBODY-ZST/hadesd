import { useEffect, useRef, useState } from "react";
import "./NativeImageLayer.css";

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type NativeImage = {
  src: string;
  left: number; top: number; width: number; height: number;
  imageLeft: number; imageTop: number; imageWidth: number; imageHeight: number;
  objectFit: string; objectPosition: string; borderRadius: string; opacity: number;
};
const clips = (value: string) => /^(hidden|clip|auto|scroll)$/.test(value);
const pixels = (value: string) => Number.parseFloat(value) || 0;

/** Geometry only: never read remote pixels or copy untrusted markup. */
export function measureNativeImage(image: HTMLImageElement, surface: HTMLElement, stage: HTMLElement): NativeImage | null {
  if (!image.isConnected || !surface.contains(image) || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  const view = surface.ownerDocument.defaultView;
  if (!view) return null;
  let url: URL;
  try { url = new URL(image.currentSrc || image.src, image.ownerDocument.baseURI); } catch { return null; }
  if (url.protocol !== "https:" || url.origin === view.location.origin || url.username || url.password) return null;
  const picture = image.getBoundingClientRect(), screen = surface.getBoundingClientRect(), origin = stage.getBoundingClientRect();
  if (picture.width <= 0 || picture.height <= 0 || screen.width <= 0 || screen.height <= 0) return null;
  const clip: Box = {
    left: Math.max(screen.left, origin.left), top: Math.max(screen.top, origin.top),
    right: Math.min(screen.right, origin.right), bottom: Math.min(screen.bottom, origin.bottom),
    width: 0, height: 0,
  };
  let opacity = 1;
  for (let ancestor: HTMLElement | null = image; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName === "DETAILS" && !(ancestor as HTMLDetailsElement).open) {
      const summary: Element | undefined = Array.from(ancestor.children).find(child => child.tagName === "SUMMARY");
      if (!summary?.contains(image)) return null;
    }
    const style = view.getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden") return null;
    // Only the surface's opacity is ignored: it hides the semantic hit layer behind GPU text.
    if (ancestor !== surface) {
      const alpha = Number.parseFloat(style.opacity);
      if (Number.isFinite(alpha)) opacity *= alpha;
      if (opacity <= 0) return null;
    }
    if (ancestor !== image) {
      const bounds = ancestor.getBoundingClientRect();
      if (clips(style.overflowX || style.overflow)) {
        clip.left = Math.max(clip.left, bounds.left + pixels(style.borderLeftWidth));
        const right = ancestor.clientWidth > 0 ? bounds.left + pixels(style.borderLeftWidth) + ancestor.clientWidth : bounds.right - pixels(style.borderRightWidth);
        clip.right = Math.min(clip.right, right);
      }
      if (clips(style.overflowY || style.overflow)) {
        clip.top = Math.max(clip.top, bounds.top + pixels(style.borderTopWidth));
        const bottom = ancestor.clientHeight > 0 ? bounds.top + pixels(style.borderTopWidth) + ancestor.clientHeight : bounds.bottom - pixels(style.borderBottomWidth);
        clip.bottom = Math.min(clip.bottom, bottom);
      }
    }
    if (ancestor === surface) break;
  }
  clip.left = Math.max(clip.left, picture.left);
  clip.top = Math.max(clip.top, picture.top);
  clip.right = Math.min(clip.right, picture.right);
  clip.bottom = Math.min(clip.bottom, picture.bottom);
  if (clip.right <= clip.left || clip.bottom <= clip.top) return null;
  const style = view.getComputedStyle(image);
  return {
    src: url.href, left: clip.left - origin.left, top: clip.top - origin.top,
    width: clip.right - clip.left, height: clip.bottom - clip.top,
    imageLeft: picture.left - clip.left, imageTop: picture.top - clip.top,
    imageWidth: picture.width, imageHeight: picture.height,
    objectFit: style.objectFit, objectPosition: style.objectPosition, borderRadius: style.borderRadius, opacity,
  };
}

/** Cross-origin pictures retain native browser rendering above the GPU canvas. */
export function NativeImageLayer({ surface }: { surface: HTMLElement }) {
  const layer = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<(NativeImage & { key: number })[]>([]);
  useEffect(() => {
    const stage = layer.current?.parentElement;
    if (!stage) return;
    let frame: number | null = null, disposed = false, sequence = 0;
    const identities = new WeakMap<HTMLImageElement, number>();
    const observed = new Set<Element>();
    const schedule = () => {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(update);
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    function update() {
      frame = null;
      if (disposed) return;
      const watched = new Set<Element>([surface, stage!]);
      const next: (NativeImage & { key: number })[] = [];
      for (const image of surface.querySelectorAll("img")) {
        for (let ancestor: HTMLElement | null = image; ancestor; ancestor = ancestor.parentElement) {
          watched.add(ancestor);
          if (ancestor === surface) break;
        }
        const picture = measureNativeImage(image, surface, stage!);
        if (!picture) continue;
        if (!identities.has(image)) identities.set(image, ++sequence);
        next.push({ ...picture, key: identities.get(image)! });
      }
      for (const element of observed) if (!watched.has(element)) { resize?.unobserve(element); observed.delete(element); }
      for (const element of watched) if (!observed.has(element)) { resize?.observe(element); observed.add(element); }
      setImages(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    const mutations = new MutationObserver(schedule);
    mutations.observe(surface, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["src", "srcset", "sizes", "class", "style", "hidden", "open", "data-terminal-reveal-step", "data-terminal-reveal"] });
    surface.addEventListener("load", schedule, true);
    surface.addEventListener("error", schedule, true);
    surface.addEventListener("scroll", schedule, true);
    surface.addEventListener("toggle", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    surface.ownerDocument.fonts?.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      mutations.disconnect(); resize?.disconnect(); observed.clear();
      surface.removeEventListener("load", schedule, true);
      surface.removeEventListener("error", schedule, true);
      surface.removeEventListener("scroll", schedule, true);
      surface.removeEventListener("toggle", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      surface.ownerDocument.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [surface]);
  return <div ref={layer} className="stage-native-images" data-native-image-layer data-native-image-count={images.length} aria-hidden="true">
    {images.map(image => <div key={image.key} className="stage-native-image-clip" style={{ left: image.left, top: image.top, width: image.width, height: image.height, opacity: image.opacity }}>
      <img src={image.src} alt="" referrerPolicy="no-referrer" draggable={false} style={{
        left: image.imageLeft, top: image.imageTop, width: image.imageWidth, height: image.imageHeight,
        objectFit: image.objectFit as "fill", objectPosition: image.objectPosition, borderRadius: image.borderRadius,
      }} />
    </div>)}
  </div>;
}
