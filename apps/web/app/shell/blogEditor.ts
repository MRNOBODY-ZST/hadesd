import type { Content } from "@hadesd/contracts";
import { request } from "../community/api";

export interface BlogDraft {
  markdown: string;
  save: (markdown: string, signal?: AbortSignal) => Promise<void>;
}

/** Load the private latest revision only on an administrator's edit intent. */
export async function loadBlogDraft(contentId: string, signal?: AbortSignal): Promise<BlogDraft> {
  const path = `/admin/contents/${encodeURIComponent(contentId)}`;
  let content = await request<Content>(path, { signal });
  return {
    markdown: content.latestRevision.markdown,
    async save(markdown, saveSignal) {
      const { title, slug, summary, tags, language, coverMediaId } = content.latestRevision;
      // Keep the original optimistic version until the server confirms a save.
      // A conflict or timeout leaves the editor's text and version intact.
      content = await request<Content>(`${path}/revisions`, {
        method: "POST", signal: saveSignal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: content.version, title, slug, summary, markdown, tags, language, coverMediaId }),
      });
    },
  };
}
