import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, extractHeadings, safeUrl } from "./index";
describe("shared markdown security", () => {
  it("rejects scripts raw HTML iframe and javascript links", () => {
    const html = renderToStaticMarkup(
      <Markdown
        source={
          '<script>alert(1)</script>\n\n<iframe src="https://x"></iframe>\n\n[bad](javascript:alert(1))\n\n![x](data:text/html,test)'
        }
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
  });
  it("renders GFM code math and stable duplicate heading anchors", () => {
    const source = "## 标题\n\n## 标题\n\n```ts\nconst a = 1;\n```\n\n$x^2$";
    const html = renderToStaticMarkup(<Markdown source={source} />);
    expect(html).toContain("heading-标题");
    expect(html).toContain("heading-标题-1");
    expect(html).toContain("复制代码");
    expect(html).toContain("katex");
    expect(extractHeadings(source).map((h) => h.id)).toEqual([
      "heading-标题",
      "heading-标题-1",
    ]);
  });
  it("only transforms known public media paths for authorized preview", () => {
    const html = renderToStaticMarkup(
      <Markdown
        source={"![alt](/api/v1/public/media/abc-123)"}
        mediaUrl={(id) => `/api/v1/admin/media/${id}/content`}
      />,
    );
    expect(html).toContain("/api/v1/admin/media/abc-123/content");
    expect(html).toContain('alt="alt"');
  });
  it("blocks protocol relative and obfuscated URL syntax", () => {
    expect(safeUrl("//evil.test")).toBe("");
    expect(safeUrl("/\\evil.test")).toBe("");
    expect(safeUrl("java\nscript:foo")).toBe("");
    expect(safeUrl("/posts/a")).toBe("/posts/a");
  });
});

describe("AST rendering agreement and advanced blocks", () => {
  it("derives TOC from the exact parsed heading tree, including nested blocks and long fences", () => {
    const source = '# **Bold** [link](https://example.com) &amp; `code` ![图](image.png)\n\n> ## Quoted \\*literal\\*\n\nSetext 标题\n===\n\n````md\n```\n# not a heading\n````\n\n## 重复\n\n## 重复';
    const headings = extractHeadings(source);
    expect(headings.map(h => h.text)).toEqual(['Bold link & code 图', 'Quoted *literal*', 'Setext 标题', '重复', '重复']);
    const html = renderToStaticMarkup(<Markdown source={source} />);
    expect(Array.from(html.matchAll(/<h[1-6] id="([^"]+)"/g), m => m[1])).toEqual(headings.map(h => h.id));
    expect(html).not.toContain('id="heading-not-a-heading"');
  });
  it("renders GFM tables, disabled task boxes and linked footnotes", () => {
    const html = renderToStaticMarkup(<Markdown source={'| Name | Value |\n|---|---|\n| item | 2 |\n\n- [x] done\n- [ ] next\n\nText[^note]\n\n[^note]: Footnote text'} />);
    expect(html).toContain('<table>'); expect(html).toContain('type="checkbox" disabled="" checked=""');
    expect(html).toContain('data-footnote-ref'); expect(html).toContain('Footnote text');
    expect(html).toContain('data-footnote-backref');
  });
  it("uses actual Python, Rust and Java grammars without interpreting code as HTML", () => {
    const html = renderToStaticMarkup(<Markdown source={'```python\ndef hello(name):\n    return f"hello {name}"\n```\n\n```rust\nfn main() { let value: u32 = 12; }\n```\n\n```java\npublic class Hello { String text = "<script>"; }\n```'} />);
    expect(html).toContain('hljs-title function_'); expect(html).toContain('hljs-type'); expect(html).toContain('hljs-keyword');
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
  });
  it("supports safe callouts and folds, ignoring author HTML/event attributes", () => {
    const html = renderToStaticMarkup(<Markdown source={'> [!NOTE]\n> A useful note\n\n:::details[Read more]{onclick="alert(1)" open style="position:fixed"}\n## Inside\n\nHidden text\n:::\n\n:::warning\nBe careful\n:::'} />);
    expect(html).toContain('<aside class="md-callout md-note">');
    expect(html).toContain('<details class="md-details"><summary>Read more</summary>');
    expect(html).toContain('md-warning'); expect(html).not.toContain('onclick'); expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('<details open');
  });
  it("SSR leaves Mermaid as inert source plus an explicit render control", () => {
    const html = renderToStaticMarkup(<Markdown source={'```mermaid\nflowchart LR\nA[Start] --> B[Done]\n```'} />);
    expect(html).toContain('渲染 Mermaid 图表'); expect(html).toContain('flowchart LR');
    expect(html).not.toContain('<svg'); expect(html).not.toContain('<script');
  });
  it("maps download attachments to private preview and escapes unsafe media URLs", () => {
    const html = renderToStaticMarkup(<Markdown source={'[记录](/api/v1/public/media/abc-123?download=true)'} mediaUrl={id => `/api/v1/admin/media/${id}/content`} />);
    expect(html).toContain('href="/api/v1/admin/media/abc-123/content?download=true" download=""');
    expect(renderToStaticMarkup(<Markdown source={'![alt](/api/v1/public/media/abc)'} mediaUrl={() => 'javascript:alert(1)'} />)).not.toContain('javascript:');
  });
  it("does not nest links for an image already inside a Markdown link", () => {
    const html = renderToStaticMarkup(<Markdown source={'[![Preview](image.png)](full.png)'} />);
    expect(Array.from(html.matchAll(/<a\b/g))).toHaveLength(1);
  });
});
