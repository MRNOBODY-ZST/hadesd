import type { Media } from "@hadesd/contracts";
import { publicMediaUrl } from "../api";

const textExtensions = new Set(["txt", "md", "markdown", "csv", "json", "log", "yaml", "yml", "toml", "ini", "conf"]);
export const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,application/zip,.png,.jpg,.jpeg,.webp,.pdf,.zip,.txt,.md,.markdown,.csv,.json,.log,.yaml,.yml,.toml,.ini,.conf";
export function validateUpload(file: File): string | null {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const text = textExtensions.has(extension);
  const image = ["png", "jpg", "jpeg", "webp"].includes(extension) || ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  const document = ["pdf", "zip"].includes(extension);
  if (["html", "htm", "xhtml", "svg", "svgz"].includes(extension) || (!text && !image && !document)) return "仅支持 PNG、JPEG、WebP 图片，PDF、ZIP 与 UTF-8 文本附件。";
  const limit = text ? 2 : image ? 10 : 25;
  if (file.size > limit * 1024 * 1024) return `${text ? "文本" : image ? "图片" : "附件"}不能超过 ${limit} MB。`;
  if (!file.size) return "不能上传空文件。";
  return null;
}
export function escapeMediaLabel(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").replace(/[\\`*_[\]{}()<>!|]/g, "\\$&");
}
export function mediaMarkdown(media: Pick<Media, "id" | "filename" | "mime">): string {
  const image = media.mime.startsWith("image/");
  return `${image ? "!" : ""}[${escapeMediaLabel(media.filename)}](${publicMediaUrl(media.id)}${image ? "" : "?download=true"})`;
}
export function insertAtSelection(markdown: string, snippet: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, markdown.length));
  const to = Math.max(from, Math.min(end, markdown.length));
  const text = `\n${snippet}\n`;
  return { markdown: markdown.slice(0, from) + text + markdown.slice(to), caret: from + text.length };
}
