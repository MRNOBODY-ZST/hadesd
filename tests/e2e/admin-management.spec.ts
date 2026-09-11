import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { AdminMedia, Content, Page, MediaBatchDeleteResult } from "@hadesd/contracts";

test.use({ reducedMotion: "reduce" });

test("real CMS media batches, compact search, reference protection and manuscript recycle lifecycle", async ({ page }) => {
  test.skip(process.env.HADESD_ISOLATED_TEST !== "true", "Management writes require an isolated database, bucket and release directory");
  const api = "/api/v1", prefix = `qa-management-${Date.now()}`;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/admin/");
  await page.getByLabel("用户名", { exact: true }).fill(process.env.ADMIN_BOOTSTRAP_USERNAME || "hades");
  await page.getByLabel("密码", { exact: true }).fill((await readFile(process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE!, "utf8")).trim());
  await page.getByRole("button", { name: "进入写作台 →" }).click();
  await expect(page.getByRole("heading", { name: "内容手记", exact: true })).toBeVisible();
  const request = page.request;
  const csrf = await (await request.get(api + "/auth/csrf")).json();
  const headers = { [csrf.headerName]: csrf.token };
  let document: Content | undefined;
  let files: AdminMedia[] = [];
  const listFiles = async () => (await (await request.get(`${api}/admin/media?q=${prefix}&size=20`)).json()) as Page<AdminMedia>;
  const card = (filename: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name: filename, exact: true }) });
  const searchMedia = async (q: string) => {
    await page.getByRole("searchbox", { name: "搜索全部媒体" }).fill(q);
    await expect.poll(async () => {
      const input = await page.getByRole("searchbox", { name: "搜索全部媒体" }).inputValue();
      return input;
    }).toBe(q);
  };
  try {
    await page.goto("/admin/#/media");
    await expect(page.getByRole("heading", { name: "媒体资料", exact: true })).toBeVisible();
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: 4, height: 4 } });
    const payloads = [
      { name: `${prefix}-old.png`, mimeType: "image/png", buffer: png },
      { name: `${prefix}-current.png`, mimeType: "image/png", buffer: png },
      ...Array.from({ length: 5 }, (_, index) => ({ name: `${prefix}-free-${index}.txt`, mimeType: "text/plain", buffer: Buffer.from(`Isolated management fixture ${index}.`) })),
    ];
    await page.getByLabel("上传媒体文件").setInputFiles(payloads);
    await expect(page.getByText("上传完成：成功 7 个，失败 0 个。", { exact: true })).toBeVisible();
    await searchMedia(prefix);
    await expect(page.getByRole("article")).toHaveCount(7);
    files = (await listFiles()).items;
    expect(files).toHaveLength(7);
    const old = files.find(file => file.filename.endsWith("-old.png"))!;
    const current = files.find(file => file.filename.endsWith("-current.png"))!;
    for (const file of files) expect((await request.get(`${api}/public/media/${file.id}`)).status()).toBe(404);
    const revision = { title: prefix, slug: prefix, summary: "隔离管理验收文稿", markdown: `![旧图](${api}/public/media/${old.id})`, tags: ["qa"], language: "zh-CN", coverMediaId: null };
    const created = await request.post(api + "/admin/contents", { headers, data: { type: "POST", ...revision } });
    expect(created.status()).toBe(201);
    document = await created.json();
    const save = await request.post(`${api}/admin/contents/${document!.id}/revisions`, { headers, data: { ...revision, version: document!.version, markdown: `![当前图](${api}/public/media/${current.id})` } });
    expect(save.status()).toBe(200);
    document = await save.json();

    // The sidebar never expands the whole collection. Its search and second
    // page must come from the real server, and insertion remains autosaved.
    await page.goto(`/admin/#/editor/${document!.id}`);
    await page.getByRole("button", { name: "媒体", exact: true }).click();
    const compact = page.getByRole("region", { name: "编辑器媒体资料" });
    await searchMedia(prefix);
    await expect(compact.getByRole("article")).toHaveCount(6);
    await compact.getByRole("button", { name: "下一页 →" }).click();
    await expect(compact.getByRole("article")).toHaveCount(1);
    await searchMedia(current.filename);
    await expect(compact.getByRole("article")).toHaveCount(1);
    await expect(compact.getByRole("heading", { name: current.filename, exact: true })).toBeVisible();
    await compact.getByRole("button", { name: "插入正文", exact: true }).click();
    await expect(page.getByLabel("MARKDOWN", { exact: true })).toHaveValue(new RegExp(current.id));
    await expect.poll(async () => (await (await request.get(`${api}/admin/contents/${document!.id}`)).json()).latestRevision.markdown).toContain(current.filename);
    await expect(page.getByRole("status").filter({ hasText: "已保存" }).first()).toBeVisible();

    await page.goto("/admin/#/media");
    await searchMedia(prefix);
    await expect(page.getByRole("article")).toHaveCount(7);
    await page.getByRole("combobox", { name: "媒体类型" }).selectOption("image");
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.getByRole("combobox", { name: "媒体类型" }).selectOption("all");
    await page.getByRole("combobox", { name: "媒体引用状态" }).selectOption("unused");
    await expect(page.getByRole("article")).toHaveCount(5);
    await page.getByRole("combobox", { name: "媒体引用状态" }).selectOption("all");
    await expect(page.getByRole("article")).toHaveCount(7);
    await card(current.filename).getByRole("button", { name: "引用详情", exact: true }).click();
    const references = page.getByRole("region", { name: `引用详情 ${current.filename}` });
    await expect(references).toContainText("最新草稿");
    await expect(references).not.toContainText("当前线上");
    await page.getByRole("button", { name: "关闭引用详情" }).click();
    await page.getByRole("checkbox", { name: "全选当前页媒体" }).check();
    await page.getByRole("button", { name: "删除所选", exact: true }).click();
    const acknowledgement = page.getByRole("checkbox", { name: /同时清理从未发布的旧修订/ });
    await expect(acknowledgement).not.toBeChecked();
    const batchResponse = page.waitForResponse(response => response.url().endsWith("/admin/media/batch-delete") && response.request().method() === "POST");
    await page.getByRole("button", { name: "确认删除所选", exact: true }).click();
    const result = await (await batchResponse).json() as MediaBatchDeleteResult;
    expect(result.results.filter(item => item.status === "DELETED")).toHaveLength(5);
    expect(result.results.filter(item => item.status === "REFERENCED")).toHaveLength(2);
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(page.getByText("处理完成：删除 5 个，2 个未删除。", { exact: true })).toBeVisible();
    await card(old.filename).getByRole("button", { name: "清理后删除", exact: true }).click();
    await expect(page.getByRole("button", { name: "确认删除所选", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: /同时清理从未发布的旧修订/ }).check();
    await page.getByRole("button", { name: "确认删除所选", exact: true }).click();
    await expect(card(old.filename)).toHaveCount(0);
    expect((await request.get(`${api}/admin/media/${old.id}/content`)).status()).toBe(404);
    expect((await request.get(`${api}/admin/media/${current.id}/content`)).status()).toBe(200);

    await page.goto("/admin/#/contents");
    await page.getByRole("searchbox", { name: "搜索全部文稿" }).fill(prefix);
    const manuscript = page.getByRole("article").filter({ has: page.getByRole("heading", { name: prefix, exact: true }) });
    await expect(manuscript).toHaveCount(1);
    page.once("dialog", dialog => dialog.accept());
    await manuscript.getByRole("button", { name: "移入回收站" }).click();
    await expect(manuscript).toHaveCount(0);
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await expect(manuscript).toHaveCount(1);
    await manuscript.getByRole("button").filter({ has: page.getByRole("heading", { name: prefix, exact: true }) }).click();
    await expect(page.getByRole("region", { name: "回收站文稿" })).toBeVisible();
    await expect(page.getByLabel("MARKDOWN", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "恢复并继续编辑", exact: true }).click();
    await expect(page.getByLabel("MARKDOWN", { exact: true })).toBeVisible();
    document = await (await request.get(`${api}/admin/contents/${document!.id}`)).json();
    expect(document!.deletedAt).toBeNull();
    expect((await request.get(`${api}/public/contents/${document!.id}`)).status()).toBe(404);
    await page.goto("/admin/#/contents");
    await page.getByRole("searchbox", { name: "搜索全部文稿" }).fill(prefix);
    page.once("dialog", dialog => dialog.accept());
    await manuscript.getByRole("button", { name: "移入回收站" }).click();
    await expect(manuscript).toHaveCount(0);
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    page.once("dialog", async dialog => { expect(dialog.message()).toContain("文稿及全部历史修订将不可恢复。媒体文件仍保留在资料库"); await dialog.accept(); });
    await manuscript.getByRole("button", { name: "永久删除", exact: true }).click();
    await expect(manuscript).toHaveCount(0);
    expect((await request.get(`${api}/admin/contents/${document!.id}`)).status()).toBe(404);
    expect((await request.get(`${api}/admin/media/${current.id}/content`)).status()).toBe(200);
    expect((await listFiles()).items).toEqual([expect.objectContaining({ id: current.id, referenceCount: 0, canDelete: true })]);
    await page.goto("/admin/#/media");
    await searchMedia(prefix);
    await expect(page.getByRole("article")).toHaveCount(1);
    await card(current.filename).getByRole("button", { name: "删除", exact: true }).click();
    await page.getByRole("button", { name: "确认删除所选", exact: true }).click();
    await expect(card(current.filename)).toHaveCount(0);
    expect((await request.get(`${api}/admin/media/${current.id}/content`)).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    // Only this test's never-published fixtures are eligible for removal.
    if (document) {
      const response = await request.get(`${api}/admin/contents/${document.id}`);
      if (response.ok()) {
        let latest = await response.json() as Content;
        if (!latest.deletedAt) {
          await request.delete(`${api}/admin/contents/${latest.id}?version=${latest.version}`, { headers });
          latest = await (await request.get(`${api}/admin/contents/${latest.id}`)).json();
        }
        await request.delete(`${api}/admin/contents/${latest.id}/purge?version=${latest.version}`, { headers });
      }
    }
    const remaining = (await listFiles()).items;
    if (remaining.length) await request.post(api + "/admin/media/batch-delete", { headers, data: { ids: remaining.map(file => file.id), discardUnusedHistory: true } });
  }
});
