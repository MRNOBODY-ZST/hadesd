import GithubSlugger from "github-slugger";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";
import { toString } from "mdast-util-to-string";

type AstNode = {
  type: string; value?: string; depth?: number; name?: string;
  children?: AstNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; [key: string]: unknown };
};
export interface Heading { id: string; text: string; depth: number }
const alerts: Record<string, string> = { NOTE: "说明", TIP: "提示", IMPORTANT: "重要", WARNING: "注意", CAUTION: "警告" };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkDirective);
const text = (node: AstNode) => toString(node as Parameters<typeof toString>[0], { includeImageAlt: true, includeHtml: false });

/** Both the TOC and rendered headings consume the same parsed Markdown tree. */
function headings(tree: AstNode): Heading[] {
  const slugger = new GithubSlugger(), result: Heading[] = [];
  const walk = (node: AstNode) => {
    if (node.type === "heading") {
      const value = text(node), id = "heading-" + slugger.slug(value);
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      result.push({ id, text: value, depth: node.depth ?? 1 });
    }
    node.children?.forEach(walk);
  };
  walk(tree);
  return result;
}
export function extractHeadings(source: string): Heading[] {
  return headings(parser.parse(source) as AstNode);
}
export function remarkStructure() {
  return (tree: unknown) => {
    const root = tree as AstNode;
    headings(root);
    const walk = (node: AstNode, parent?: AstNode) => {
      if (node.type === "image" && (parent?.type === "link" || parent?.type === "linkReference")) node.data = { hProperties: { dataImageLinked: "true" } };
      if (node.type === "blockquote") {
        const first = node.children?.[0]?.children?.[0];
        const match = first?.type === "text" && first.value?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/);
        if (match) {
          first!.value = first!.value!.slice(match[0].length);
          node.data = { hName: "aside", hProperties: { className: ["md-callout", "md-" + match[1]!.toLowerCase()] } };
          node.children!.unshift({ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: alerts[match[1]!] }] }] });
        }
      }
      // Explicit safe directive vocabulary; author-supplied attributes are ignored.
      if (node.type === "containerDirective" && node.name === "details") {
        const label = node.children?.[0];
        const hasLabel = !!label?.data?.directiveLabel;
        node.data = { hName: "details", hProperties: { className: ["md-details"] } };
        if (hasLabel) label!.data = { hName: "summary" };
        else node.children?.unshift({ type: "paragraph", data: { hName: "summary" }, children: [{ type: "text", value: "展开详情" }] });
      } else if (node.type === "containerDirective" && node.name && alerts[node.name.toUpperCase()]) {
        const kind = node.name.toUpperCase();
        node.data = { hName: "aside", hProperties: { className: ["md-callout", "md-" + node.name.toLowerCase()] } };
        node.children?.unshift({ type: "paragraph", children: [{ type: "strong", children: [{ type: "text", value: alerts[kind] }] }] });
      }
      node.children?.forEach(child => walk(child, node));
    };
    walk(root);
  };
}
export const remarkPlugins = [remarkGfm, remarkMath, remarkDirective, remarkStructure];
