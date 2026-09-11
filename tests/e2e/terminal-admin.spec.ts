import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ reducedMotion: "reduce" });
const api = "/api/v1";
async function csrf(request: APIRequestContext) { return (await request.get(api + "/auth/csrf")).json() as Promise<{ headerName: string; token: string }>; }

test("administrator Vim saves a private revision and retains text on concurrent-edit conflicts", async ({ page }) => {
  test.skip(process.env.HADESD_ISOLATED_TEST !== "true", "Publishing verification requires HADESD_ISOLATED_TEST=true and an isolated database, bucket and release directory");
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || "hades";
  const request = page.request;
  let token = await csrf(request);
  expect((await request.post(api + "/auth/login", { headers: { [token.headerName]: token.token }, form: {
    username,
    password: (await readFile(process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE!, "utf8")).trim(),
  } })).status()).toBe(200);
  token = await csrf(request);
  const headers = { [token.headerName]: token.token };
  const initial = await (await request.get(api + "/public/release")).json();
  const slug = `qa-vim-${Date.now()}`;
  const revision = { title: "终端保存验收示例", slug, summary: "隔离测试文章", markdown: "# 已发布测试正文\n\n公开版本保持不变。", tags: ["验收示例"], language: "zh-CN" };
  const response = await request.post(api + "/admin/contents", { headers, data: { type: "POST", ...revision } });
  expect(response.status()).toBe(201);
  const content = await response.json();
  async function publish(data: object) {
    const response = await request.post(api + "/admin/publish-jobs", { headers, data });
    expect(response.status()).toBe(202);
    const job = await response.json();
    await expect.poll(async () => {
      const state = await (await request.get(api + `/admin/publish-jobs/${job.id}`)).json();
      if (state.status === "FAILED") throw new Error(state.error || "Publication failed");
      return state.status;
    }, { timeout: 180000, intervals: [1000] }).toBe("SUCCEEDED");
  }
  async function ex(command: string) {
    await page.keyboard.press(":");
    const field = page.getByRole("textbox", { name: "Vim 命令", exact: true });
    await field.fill(command); await field.press("Enter");
  }
  try {
    await publish({ operation: "PUBLISH", contentId: content.id, revisionId: content.latestRevision.id });
    await page.addInitScript(() => localStorage.setItem("hadesd.display.v2", JSON.stringify({ theme: "amber", crt: "off", reader: false })));
    await page.goto(`/posts/${slug}`);
    await expect(page.locator(".terminal-stage")).toHaveAttribute("data-stage-ready", "true");
    await expect(page.locator(".community-bar")).toContainText("@" + username);
    const shell = page.getByRole("textbox", { name: "博客命令", exact: true });
    await shell.fill(`vim /posts/${slug}.md`); await shell.press("Enter");
    const editor = page.getByRole("region", { name: "Vim 编辑器", exact: true });
    await expect(editor).toBeVisible(); await page.keyboard.press("i");
    await expect(editor).toContainText("SERVER DRAFT");
    const text = page.getByRole("textbox", { name: "Vim 文本", exact: true });
    await text.fill("# 仅保存至后端的 Vim 草稿"); await text.press("Escape");
    await ex("wq"); await expect(editor).toHaveCount(0);
    const saved = await (await request.get(api + `/admin/contents/${content.id}`)).json();
    expect(saved.latestRevision.markdown).toBe("# 仅保存至后端的 Vim 草稿");
    expect(saved.latestRevision.title).toBe(revision.title);
    expect((await (await request.get(api + `/public/contents/${content.id}`)).json()).markdown).toBe(revision.markdown);
    await shell.fill(`vim /posts/${slug}.md`); await shell.press("Enter");
    await expect(editor).toBeVisible(); await page.keyboard.press("i");
    await expect(text).toHaveValue(saved.latestRevision.markdown);
    expect((await request.post(api + `/admin/contents/${content.id}/revisions`, { headers, data: { ...revision, version: saved.version, markdown: "# 另一标签页的新草稿" } })).status()).toBe(200);
    await text.fill("# 保留当前未保存文字"); await text.press("Escape"); await ex("w");
    await expect(editor).toContainText("E212");
    await expect(editor).toContainText("保留当前未保存文字");
    await ex("q!"); await expect(editor).toHaveCount(0);
  } finally {
    await publish(initial.releaseId ? { operation: "ROLLBACK", releaseId: initial.releaseId } : { operation: "WITHDRAW", contentId: content.id });
  }
});
