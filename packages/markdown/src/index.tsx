import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { remarkPlugins } from "./structure";
import { highlight } from "./highlight";
import { validateDiagram } from "./mermaidPolicy";
import "katex/dist/katex.min.css";
import "./markdown.css";
export { extractHeadings, type Heading } from "./structure";

export function safeUrl(url: string): string {
  const trimmed = url.trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed) || trimmed.startsWith("//") || trimmed.includes("\\")) return "";
  return defaultUrlTransform(trimmed);
}
function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === "string" || typeof child === "number"
    ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "").join("");
}

/** Native images remain usable without CORS; original links also work in the GPU terminal. */
export function MarkdownImage({ src, alt, title, linked = false }: { src: string; alt: string; title?: string; linked?: boolean }) {
  const url = safeUrl(src);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setFailed(false); setAttempt(0); }, [url]);
  const picture = url && !failed ? <img key={`${url}:${attempt}`} src={url} alt={alt} title={title} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <span className="md-image-error" role="status">图片暂时无法显示{alt ? `：${alt}` : ""}</span>;
  return <span className="md-image">
    {linked || !url ? picture : <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`查看原图${alt ? `：${alt}` : ""}`}>{picture}</a>}
    {(title || alt) && <span className="md-image-caption">{title || alt}</span>}
    {!linked && url && <span className="md-image-actions"><a href={url} target="_blank" rel="noopener noreferrer">查看原图 ↗</a>
      {failed && <button type="button" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>重新加载</button>}
      {/^https?:/i.test(url) && <span className="md-image-hint">终端中若未显示，请打开原图或切换阅读模式。</span>}
    </span>}
  </span>;
}

function MermaidDiagram({ source }: { source: string }) {
  const [result, setResult] = useState<{ source: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  useEffect(() => { generation.current++; setPending(false); setError(""); }, [source]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  async function render() {
    const invalid = validateDiagram(source);
    if (invalid) { setError(invalid); return; }
    const run = ++generation.current;
    setPending(true); setError("");
    try {
      // The sizeable diagram renderer is fetched only after an explicit user action.
      const { renderDiagram } = await import("./renderMermaid");
      const svg = await renderDiagram(source);
      if (generation.current !== run) return;
      setResult({ source, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch {
      if (generation.current === run) setError("图表无法渲染，请检查 Mermaid 语法。源代码已保留。");
    } finally { if (generation.current === run) setPending(false); }
  }
  return <div className="md-mermaid">
    <div className="md-diagram-controls"><button type="button" disabled={pending} onClick={() => void render()}>{pending ? "正在绘制图表…" : result?.source === source ? "重新绘制图表" : "渲染 Mermaid 图表"}</button><span>按需加载 · 始终保留源代码</span></div>
    {error && <p className="md-diagram-error" role="alert">{error}</p>}
    {result?.source === source && <img className="md-diagram" src={result.url} alt="Mermaid 图表，完整源代码在下方" />}
  </div>;
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState("复制代码");
  const code = Children.toArray(children).find(child => isValidElement(child));
  const language = isValidElement<{ className?: string }>(code) ? code.props.className?.match(/language-([\w-]+)/)?.[1] : undefined;
  const source = textContent(children).replace(/\n$/, "");
  async function copy() {
    try { await navigator.clipboard.writeText(source); setStatus("已复制"); }
    catch { setStatus("复制失败，请手动选择"); }
  }
  return <div className="md-code">
    <div className="md-code-toolbar"><span>{language?.toUpperCase() || "CODE"}</span><button type="button" onClick={copy}>{status}</button></div>
    {language === "mermaid" && <MermaidDiagram source={source} />}
    <pre>{children}</pre>
  </div>;
}
function HighlightCode({ children, className }: { children?: ReactNode; className?: string }) {
  const language = className?.match(/language-([\w-]+)/)?.[1]?.toLowerCase();
  return <code className={className}>{language ? highlight(textContent(children), language) : children}</code>;
}
const schema = {
  ...defaultSchema, clobberPrefix: "",
  tagNames: [...(defaultSchema.tagNames ?? []), "aside", "details", "summary"],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-./, "math-inline", "math-display"]],
    aside: [["className", "md-callout", "md-note", "md-tip", "md-important", "md-warning", "md-caution"]],
    details: [["className", "md-details"]],
    img: [...(defaultSchema.attributes?.img ?? []), "dataImageLinked"],
  },
};
export function Markdown({ source, mediaUrl }: { source: string; mediaUrl?: (id: string) => string }) {
  return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={remarkPlugins} remarkRehypeOptions={{ footnoteLabel: "脚注", footnoteBackLabel: "返回正文" }}
    rehypePlugins={[[rehypeSanitize, schema], [rehypeKatex, { trust: false, strict: "warn", throwOnError: false, maxExpand: 1000, maxSize: 20 }]]}
    urlTransform={(url) => {
      const valid = safeUrl(url);
      const match = valid.match(/^\/api\/v1\/public\/media\/([A-Za-z0-9-]+)(\?download=true)?$/);
      if (!match || !mediaUrl) return valid;
      const mapped = safeUrl(mediaUrl(match[1]!));
      return mapped && match[2] ? `${mapped}${mapped.includes("?") ? "&" : "?"}download=true` : mapped;
    }}
    components={{
      pre: CodeBlock, code: HighlightCode,
      a: ({ href, title, children, node: _node, ...props }) => <a {...props} href={safeUrl(href ?? "")} title={title} download={/[?&]download=true(?:&|$)/.test(href ?? "") || undefined} rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}>{children}</a>,
      img: ({ src, alt, title, node }) => <MarkdownImage src={typeof src === "string" ? src : ""} alt={alt ?? ""} title={title} linked={node?.properties.dataImageLinked === "true"} />,
      table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
    }}>{source}</ReactMarkdown></div>;
}
