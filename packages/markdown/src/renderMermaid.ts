import mermaid from "mermaid";
import DOMPurify from "dompurify";
import { validateDiagram } from "./mermaidPolicy";

mermaid.initialize({
  startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
  maxTextSize: 20_000, maxEdges: 300, htmlLabels: false, layout: "dagre",
  flowchart: { htmlLabels: false }, fontFamily: "monospace", theme: "neutral",
  secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "flowchart", "layout"],
});
let serial = Promise.resolve();
let sequence = 0;
/** Only imported after an explicit render click; never evaluated while SSR renders. */
export function renderDiagram(source: string): Promise<string> {
  const invalid = validateDiagram(source);
  if (invalid) return Promise.reject(new Error(invalid));
  const result = serial.then(async () => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;pointer-events:none";
    host.setAttribute("aria-hidden", "true"); document.body.append(host);
    try {
      const { svg } = await mermaid.render("hadesd-diagram-" + ++sequence, source, host);
      // Render as an image, not interactive inline HTML. Strip active SVG surfaces.
      return DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "script", "iframe", "image", "a"],
        ADD_ATTR: ["dominant-baseline"],
      });
    } finally { host.remove(); }
  });
  serial = result.then(() => undefined, () => undefined);
  return result;
}
