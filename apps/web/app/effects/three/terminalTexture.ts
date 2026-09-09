/**
 * Paint the terminal's existing DOM into a GPU-uploadable canvas, on changes only.
 * DOM remains the source of layout, hit testing, input, selection and semantics.
 * This deliberately implements our compact terminal, not a general screenshotter:
 * CSS gradients, filters, pseudo elements and arbitrary 3D CSS transforms are not
 * reproduced. Keep the real DOM available whenever the GPU surface is disabled.
 */
export interface TerminalSurface {
  canvas: HTMLCanvasElement;
  refresh: () => void;
  dispose: () => void;
}

const MAX_CHARACTERS = 25_000;
const MAX_ELEMENTS = 4_000;
const MAX_WIDTH = 1_600;
const MAX_PIXELS = 2_000_000;
const OMIT = "script,style,noscript,template,canvas,.sr-only,.katex-mathml,[data-terminal-capture='skip']";

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const number = (value: string) => Number.parseFloat(value) || 0;
const overlaps = (a: Box, b: Box) => a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
const transparent = (color: string) => color === "transparent" || /^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color) || /\/\s*0(?:\.0+)?\s*\)$/.test(color);

export function createTerminalSurface(element: HTMLElement, onUpdate: () => void): TerminalSurface {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error("The terminal surface needs a browser document.");
  const canvas = doc.createElement("canvas");
  canvas.width = canvas.height = 2;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("A 2D canvas is required for the terminal surface.");
  ctx.fillStyle = "#060805";
  ctx.fillRect(0, 0, 2, 2);
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let disposed = false;
  let frame: number | null = null;

  function paint() {
    if (disposed || !ctx || !view) return;
    const root = element.getBoundingClientRect();
    // Retain the last valid texture through transient layout/unmount measurements.
    if (root.width < 2 || root.height < 2 || !element.isConnected) return;
    const scale = Math.min(view.devicePixelRatio || 1, 1.25, MAX_WIDTH / root.width, Math.sqrt(MAX_PIXELS / (root.width * root.height)));
    const width = Math.max(2, Math.round(root.width * scale));
    const height = Math.max(2, Math.round(root.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#060805";
    ctx.fillRect(0, 0, root.width, root.height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, root.width, root.height);
    ctx.clip();
    let remaining = MAX_CHARACTERS;
    let elements = 0;
    const range = doc.createRange();

    function font(style: CSSStyleDeclaration) {
      ctx!.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx!.textAlign = "left";
      ctx!.textBaseline = "alphabetic";
      ctx!.direction = style.direction === "rtl" ? "rtl" : "ltr";
      ctx!.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
      ctx!.fontKerning = style.fontKerning as CanvasFontKerning;
      ctx!.fillStyle = style.color;
    }

    function textTransform(value: string, style: CSSStyleDeclaration) {
      if (style.textTransform === "uppercase") return value.toLocaleUpperCase();
      if (style.textTransform === "lowercase") return value.toLocaleLowerCase();
      if (style.textTransform === "capitalize") return value.replace(/(^|\s)(\S)/g, (_, space: string, char: string) => space + char.toLocaleUpperCase());
      return value;
    }

    function drawText(value: string, box: Box, style: CSSStyleDeclaration, decoration: string) {
      if (!value || !overlaps(box, root) || transparent(style.color)) return;
      font(style);
      const metrics = ctx!.measureText("Mg国");
      const ascent = metrics.fontBoundingBoxAscent || number(style.fontSize) * 0.8;
      const descent = metrics.fontBoundingBoxDescent || number(style.fontSize) * 0.2;
      const baseline = box.top - root.top + (box.height - ascent - descent) / 2 + ascent;
      const x = box.left - root.left;
      ctx!.fillText(textTransform(value, style), x, baseline);
      if (decoration.includes("underline") || decoration.includes("line-through")) {
        ctx!.strokeStyle = transparent(style.textDecorationColor) ? style.color : style.textDecorationColor;
        ctx!.lineWidth = Math.max(0.6, number(style.textDecorationThickness) || 0.7);
        const y = decoration.includes("line-through") ? baseline - ascent * 0.35 : baseline + Math.max(2, number(style.textUnderlineOffset));
        ctx!.beginPath(); ctx!.moveTo(x, y); ctx!.lineTo(x + box.width, y); ctx!.stroke();
      }
    }

    function text(node: Text, style: CSSStyleDeclaration, clip: Box, decoration: string) {
      if (!remaining || !node.data || transparent(style.color)) return;
      range.selectNodeContents(node);
      const boxes = Array.from(range.getClientRects()).filter((box) => box.width > 0 && box.height > 0);
      if (!boxes.some((box) => overlaps(box, clip))) return;
      const data = node.data.slice(0, remaining);
      remaining -= data.length;
      const preservesSpaces = /^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace);
      // Ordinary single lines need one layout read, not a Range read per letter.
      const simpleWhitespace = preservesSpaces ? !/[\t\r\n]/.test(data) : !/[\t\r\n\f]| {2,}|^ | $/.test(data);
      if (boxes.length === 1 && simpleWhitespace && data.length === node.data.length) {
        drawText(data, boxes[0]!, style, decoration);
        return;
      }
      let run = "";
      let runBox: Box | null = null;
      const flush = () => { if (runBox) drawText(run, runBox, style, decoration); run = ""; runBox = null; };
      for (const { segment, index } of segmenter.segment(data)) {
        range.setStart(node, index);
        range.setEnd(node, index + segment.length);
        const box = range.getBoundingClientRect();
        if (!box.width || !box.height || !overlaps(box, clip)) { flush(); continue; }
        // A collapsed newline has a space's geometry; preformatted tabs are gaps.
        const glyph = /[\t\r\n\f]/.test(segment) ? (preservesSpaces ? "" : " ") : segment;
        if (!glyph) { flush(); continue; }
        if (runBox && (Math.abs(box.top - runBox.top) > 1 || Math.abs(box.height - runBox.height) > 1 || Math.abs(box.left - runBox.right) > 1.5)) flush();
        if (!runBox) runBox = { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
        else { runBox.right = box.right; runBox.width = runBox.right - runBox.left; }
        run += glyph;
      }
      flush();
    }

    function border(box: Box, style: CSSStyleDeclaration) {
      const x = box.left - root.left, y = box.top - root.top;
      const sides = [
        [style.borderTopWidth, style.borderTopStyle, style.borderTopColor, x, y, x + box.width, y],
        [style.borderRightWidth, style.borderRightStyle, style.borderRightColor, x + box.width, y, x + box.width, y + box.height],
        [style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor, x, y + box.height, x + box.width, y + box.height],
        [style.borderLeftWidth, style.borderLeftStyle, style.borderLeftColor, x, y, x, y + box.height],
      ] as const;
      for (const [width, kind, color, x1, y1, x2, y2] of sides) {
        const thickness = number(width);
        if (!thickness || kind === "none" || kind === "hidden" || transparent(color)) continue;
        ctx!.strokeStyle = color; ctx!.lineWidth = thickness;
        ctx!.setLineDash(kind === "dashed" ? [4, 3] : kind === "dotted" ? [1, 2] : []);
        ctx!.beginPath(); ctx!.moveTo(x1, y1); ctx!.lineTo(x2, y2); ctx!.stroke();
      }
      ctx!.setLineDash([]);
    }

    function input(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, box: Box, style: CSSStyleDeclaration) {
      if (control.tagName === "INPUT" && (control as HTMLInputElement).type === "hidden") return;
      const type = control.tagName === "INPUT" ? (control as HTMLInputElement).type : "";
      font(style);
      if (type === "checkbox" || type === "radio") {
        if ((control as HTMLInputElement).checked) {
          ctx!.fillStyle = style.accentColor === "auto" ? style.color : style.accentColor;
          ctx!.fillRect(box.left - root.left + 3, box.top - root.top + 3, Math.max(1, box.width - 6), Math.max(1, box.height - 6));
        }
        return;
      }
      const placeholder = control.tagName === "SELECT" ? "" : (control as HTMLInputElement).placeholder;
      let value = control.tagName === "SELECT" ? (control as HTMLSelectElement).selectedOptions[0]?.textContent || "" : control.value;
      if (type === "password") value = "•".repeat(value.length);
      if (!value) {
        value = placeholder;
        const placeholderStyle = view!.getComputedStyle(control, "::placeholder");
        ctx!.fillStyle = placeholderStyle.color || style.color;
      }
      if (!remaining || !value || transparent(ctx!.fillStyle as string)) return;
      value = value.slice(0, remaining); remaining -= value.length;
      const paddingLeft = number(style.paddingLeft), paddingTop = number(style.paddingTop);
      const borderLeft = number(style.borderLeftWidth), borderTop = number(style.borderTopWidth);
      const x = box.left - root.left + paddingLeft + borderLeft - control.scrollLeft;
      const top = box.top - root.top + paddingTop + borderTop - control.scrollTop;
      const lineHeight = number(style.lineHeight) || number(style.fontSize) * 1.2;
      const available = Math.max(1, box.width - paddingLeft - number(style.paddingRight) - borderLeft - number(style.borderRightWidth));
      const metrics = ctx!.measureText("Mg国");
      const ascent = metrics.fontBoundingBoxAscent || number(style.fontSize) * 0.8;
      const descent = metrics.fontBoundingBoxDescent || number(style.fontSize) * 0.2;
      const baseline = top + (lineHeight - ascent - descent) / 2 + ascent;
      ctx!.save(); ctx!.beginPath(); ctx!.rect(box.left - root.left + borderLeft, box.top - root.top + borderTop, box.width - borderLeft - number(style.borderRightWidth), box.height - borderTop - number(style.borderBottomWidth)); ctx!.clip();
      let line = "", row = 0;
      for (const { segment } of segmenter.segment(value)) {
        const wrap = control.tagName === "TEXTAREA" && (control as HTMLTextAreaElement).wrap !== "off";
        if (segment === "\n" || (wrap && line && ctx!.measureText(line + segment).width > available)) {
          ctx!.fillText(line, x, baseline + row++ * lineHeight); line = "";
        }
        if (segment !== "\n" && segment !== "\r") line += segment === "\t" ? "    " : segment;
      }
      ctx!.fillText(line, x, baseline + row * lineHeight);
      ctx!.restore();
    }

    function image(img: HTMLImageElement, box: Box) {
      if (!img.complete || !img.naturalWidth) return;
      try {
        const url = new URL(img.currentSrc || img.src, doc.baseURI);
        // Do not taint the canvas with a remote image without an explicit CORS load.
        if (url.origin !== view!.location.origin && !/^data:image\/(png|jpeg|webp|gif|avif);/i.test(url.href) && !img.crossOrigin) return;
        ctx!.drawImage(img, box.left - root.left, box.top - root.top, box.width, box.height);
      } catch { /* Broken/unsupported media retains its real DOM fallback. */ }
    }

    function svg(svg: SVGSVGElement) {
      // KaTeX radicals and terminal icons use simple SVG paths, not foreignObject.
      for (const shape of Array.from(svg.querySelectorAll<SVGGraphicsElement>("path,line,rect,circle,ellipse,polygon,polyline")).slice(0, 200)) {
        if (shape.closest("defs,clipPath,mask,symbol")) continue;
        const matrix = shape.getScreenCTM();
        if (!matrix) continue;
        const style = view!.getComputedStyle(shape);
        if (style.display === "none" || style.visibility === "hidden") continue;
        try {
          const path = new Path2D();
          const attr = (name: string) => number(shape.getAttribute(name) || "0");
          if (shape.tagName === "path") path.addPath(new Path2D(shape.getAttribute("d") || ""));
          else if (shape.tagName === "line") { path.moveTo(attr("x1"), attr("y1")); path.lineTo(attr("x2"), attr("y2")); }
          else if (shape.tagName === "rect") path.rect(attr("x"), attr("y"), attr("width"), attr("height"));
          else if (shape.tagName === "circle" || shape.tagName === "ellipse") path.ellipse(attr("cx"), attr("cy"), shape.tagName === "circle" ? attr("r") : attr("rx"), shape.tagName === "circle" ? attr("r") : attr("ry"), 0, 0, Math.PI * 2);
          else {
            const points = (shape.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
            for (let i = 0; i + 1 < points.length; i += 2) { if (i === 0) path.moveTo(points[i]!, points[i + 1]!); else path.lineTo(points[i]!, points[i + 1]!); }
            if (shape.tagName === "polygon") path.closePath();
          }
          ctx!.save();
          ctx!.setTransform(scale * matrix.a, scale * matrix.b, scale * matrix.c, scale * matrix.d, scale * (matrix.e - root.left), scale * (matrix.f - root.top));
          if (style.fill !== "none" && !style.fill.startsWith("url(")) { ctx!.fillStyle = style.fill === "currentcolor" ? style.color : style.fill; ctx!.fill(path, style.fillRule === "evenodd" ? "evenodd" : "nonzero"); }
          if (style.stroke !== "none" && !style.stroke.startsWith("url(")) { ctx!.strokeStyle = style.stroke; ctx!.lineWidth = number(style.strokeWidth) || 1; ctx!.stroke(path); }
          ctx!.restore();
        } catch { /* Advanced SVG remains available in the DOM fallback. */ }
      }
    }

    function visit(node: Element, clip: Box, decoration = "none") {
      if (++elements > MAX_ELEMENTS || node.matches(OMIT)) return;
      const style = view!.getComputedStyle(node);
      const isCursor = node.hasAttribute("data-terminal-cursor");
      if (style.display === "none" || (!isCursor && (style.visibility === "hidden" || style.visibility === "collapse"))) return;
      const box = node.getBoundingClientRect();
      const visible = overlaps(box, clip);
      ctx!.save();
      // Ancestor/root opacity is intentionally ignored: the GPU replaces its ink.
      // Cursor opacity is animated in the GPU, never sampled at a random CSS phase.
      if (node !== element && !isCursor) ctx!.globalAlpha *= Number.parseFloat(style.opacity) || (style.opacity === "0" ? 0 : 1);
      if (visible) {
        if (!transparent(style.backgroundColor)) {
          ctx!.fillStyle = style.backgroundColor;
          for (const fragment of Array.from(node.getClientRects())) {
            ctx!.beginPath();
            ctx!.roundRect(fragment.left - root.left, fragment.top - root.top, fragment.width, fragment.height, Math.min(number(style.borderTopLeftRadius), fragment.width / 2, fragment.height / 2));
            ctx!.fill();
          }
        }
        border(box, style);
        if (style.outlineStyle !== "none" && number(style.outlineWidth)) {
          ctx!.strokeStyle = style.outlineColor; ctx!.lineWidth = number(style.outlineWidth);
          const offset = number(style.outlineOffset);
          ctx!.strokeRect(box.left - root.left - offset, box.top - root.top - offset, box.width + offset * 2, box.height + offset * 2);
        }
      }
      const clipsX = /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
      const clipsY = /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
      let nextClip = clip;
      if (clipsX || clipsY) {
        const left = clipsX ? Math.max(clip.left, box.left + number(style.borderLeftWidth)) : clip.left;
        const right = clipsX ? Math.min(clip.right, box.right - number(style.borderRightWidth)) : clip.right;
        const top = clipsY ? Math.max(clip.top, box.top + number(style.borderTopWidth)) : clip.top;
        const bottom = clipsY ? Math.min(clip.bottom, box.bottom - number(style.borderBottomWidth)) : clip.bottom;
        nextClip = { left, right, top, bottom, width: right - left, height: bottom - top };
        if (nextClip.width <= 0 || nextClip.height <= 0) { ctx!.restore(); return; }
        ctx!.beginPath(); ctx!.rect(left - root.left, top - root.top, right - left, bottom - top); ctx!.clip();
      }
      if (visible && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName)) input(node as HTMLInputElement, box, style);
      else if (visible && node.tagName === "IMG") image(node as HTMLImageElement, box);
      else if (visible && node.tagName.toLowerCase() === "svg") svg(node as SVGSVGElement);
      else {
        const inheritedDecoration = style.textDecorationLine === "none" ? decoration : style.textDecorationLine;
        // Closed details retain measurable descendant boxes in Chromium, although
        // the browser only paints their first summary. Do not copy hidden ink.
        const children = node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open
          ? Array.from(node.children).filter(child => child.tagName === "SUMMARY").slice(0, 1)
          : node.childNodes;
        for (const child of children) {
          if (child.nodeType === 1) visit(child as Element, nextClip, inheritedDecoration);
          else if (child.nodeType === 3) text(child as Text, style, nextClip, inheritedDecoration);
        }
      }
      ctx!.restore();
    }

    visit(element, root);
    const selection = doc.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode)) {
      ctx.fillStyle = "rgba(224, 188, 99, 0.2)";
      for (const box of Array.from(selection.getRangeAt(0).getClientRects()).slice(0, 200)) {
        if (overlaps(box, root)) ctx.fillRect(box.left - root.left, box.top - root.top, box.width, box.height);
      }
    }
    ctx.restore();
    onUpdate();
  }

  function refresh() {
    if (disposed || frame !== null || !view) return;
    frame = view.requestAnimationFrame(() => { frame = null; paint(); });
  }
  const observer = new view.MutationObserver(refresh);
  observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
  // Theme variables live above the captured root; they also invalidate its ink.
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme", "data-reader"] });
  const resize = typeof view.ResizeObserver === "undefined" ? null : new view.ResizeObserver(refresh);
  resize?.observe(element);
  const events = ["input", "change", "keyup", "focus", "blur", "pointerover", "pointerout", "pointerdown", "pointerup", "load", "error", "scroll", "toggle", "transitionend", "animationend"];
  for (const event of events) element.addEventListener(event, refresh, true);
  doc.addEventListener("selectionchange", refresh);
  view.addEventListener("resize", refresh);
  doc.fonts?.addEventListener("loadingdone", refresh);
  void doc.fonts?.ready.then(refresh);
  refresh();
  return {
    canvas,
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      frame = null;
      observer.disconnect(); resize?.disconnect();
      for (const event of events) element.removeEventListener(event, refresh, true);
      doc.removeEventListener("selectionchange", refresh);
      view.removeEventListener("resize", refresh);
      doc.fonts?.removeEventListener("loadingdone", refresh);
    },
  };
}
