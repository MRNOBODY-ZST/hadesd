import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Content } from "@hadesd/contracts";

let loadBlogDraft: typeof import("./blogEditor").loadBlogDraft;
const content: Content = {
  id: "post-1", type: "POST", version: 7, createdAt: "2026-09-11T00:00:00Z",
  latestRevision: { id: "revision-7", contentId: "post-1", createdAt: "2026-09-11T00:00:00Z",
    title: "An existing draft", slug: "existing", summary: "Summary", markdown: "Unpublished draft",
    tags: ["terminal"], language: "zh-CN", coverMediaId: "cover-1" },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
beforeEach(async () => { vi.resetModules(); ({ loadBlogDraft } = await import("./blogEditor")); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("loads the latest private draft and saves markdown preserving metadata and advancing optimistic version", async () => {
  const saves: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/auth/csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "csrf" });
    if (options?.method === "POST") {
      expect(path).toBe("/api/v1/admin/contents/post-1/revisions");
      expect(new Headers(options.headers).get("X-CSRF-TOKEN")).toBe("csrf");
      const body = JSON.parse(options.body as string); saves.push(body);
      return json({ ...content, version: Number(body.version) + 1, latestRevision: { ...content.latestRevision, markdown: body.markdown } });
    }
    expect(path).toBe("/api/v1/admin/contents/post-1"); return json(content);
  }));
  const draft = await loadBlogDraft("post-1");
  expect(draft.markdown).toBe("Unpublished draft");
  await draft.save("New markdown"); await draft.save("Second save");
  expect(saves).toEqual([7, 8].map((version, index) => ({ version, title: content.latestRevision.title,
    slug: "existing", summary: "Summary", markdown: index ? "Second save" : "New markdown",
    tags: ["terminal"], language: "zh-CN", coverMediaId: "cover-1" })));
});

it("retains the prior version after a conflict and never publishes or force-overwrites", async () => {
  const mutations: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/auth/csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "csrf" });
    if (options?.method === "POST") { mutations.push(JSON.parse(options.body as string)); return json({ code: "VERSION_CONFLICT", detail: "另一处已修改，请重新打开草稿。" }, 409); }
    return json(content);
  }));
  const draft = await loadBlogDraft("post-1");
  await expect(draft.save("Keep my text")).rejects.toMatchObject({ status: 409 });
  expect(mutations).toHaveLength(1); expect(mutations[0]?.version).toBe(7);
});

it("does not bypass authentication when loading a draft", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => json({ detail: "请先登录" }, 401)));
  await expect(loadBlogDraft("post-1")).rejects.toMatchObject({ status: 401 });
});
