import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const origin =
  process.env.ADMIN_TEST_ORIGIN ||
  `http://127.0.0.1:${process.env.LOCAL_PORT || 18088}`;
const directory = new URL("../artifacts/", import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1040 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const checks = [];
try {
  await page.goto(`${origin}/admin/`);
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible({
    timeout: 25000,
  });
  await page.screenshot({
    path: new URL("login-desktop.png", directory).pathname,
    fullPage: true,
  });
  await page
    .getByLabel("用户名", { exact: true })
    .fill(process.env.ADMIN_BOOTSTRAP_USERNAME || "hades");
  await page
    .getByLabel("密码", { exact: true })
    .fill(
      (
        await readFile(process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE, "utf8")
      ).trim(),
    );
  await page.getByRole("button", { name: "进入写作台 →" }).click();
  await expect(
    page.getByRole("heading", { name: "内容手记", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: new URL("contents-desktop.png", directory).pathname,
    fullPage: true,
  });
  checks.push("真实 Session 表单登录及内容列表");
  await page.getByRole("button", { name: "＋ 新建内容", exact: true }).click();
  await page.getByLabel("标题", { exact: true }).fill("后台验证 · 写作与修订");
  const slug = `admin-qa-${Date.now()}`;
  await page.getByLabel("永久链接标识", { exact: true }).fill(slug);
  await page
    .getByRole("button", { name: "创建并开始写作 →", exact: true })
    .click();
  await expect(page.getByLabel("内容标题", { exact: true })).toHaveValue(
    "后台验证 · 写作与修订",
  );
  await page
    .getByLabel("内容摘要", { exact: true })
    .fill("明确标记的本地验证草稿，检查真实保存、私有预览与不可变修订。");
  await page
    .getByLabel("MARKDOWN", { exact: true })
    .fill(
      "## 让想法慢慢成形\n\n这是一份**本地验证草稿**，不会自动发布。\n\n### 记录与留白\n\n写作是把模糊的想法慢慢变清楚。每次保存，都是向前一步。\n\n```java\nreturn repository.findById(id)\n    .flatMap(this::publish);\n```\n\n| 操作 | 结果 |\n| --- | --- |\n| 保存 | 私有修订 |\n| 发布 | 公开快照 |\n\n$$L = \\lambda W$$\n\n<script>window.__adminXss = true</script>",
    );
  await page.getByLabel("标签", { exact: true }).fill("写作, 测试");
  await page.getByLabel("标签", { exact: true }).press("Enter");
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "已保存" })
      .first(),
  ).toBeVisible({ timeout: 10000 });
  checks.push("创建、debounce 自动保存、标签、数学与安全预览");
  const draftUrl = page.url();
  await page.reload();
  await expect(page.getByLabel("MARKDOWN", { exact: true })).toHaveValue(
    /让想法慢慢成形/,
  );
  expect(await page.evaluate(() => window.__adminXss)).toBeUndefined();
  checks.push("刷新后真实数据库内容保留，Markdown 不执行脚本");
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.getByLabel("上传媒体文件").setInputFiles({
    name: `${slug}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByText(new RegExp(`已上传 ${slug}`))).toBeVisible({
    timeout: 10000,
  });
  const file = page.locator("article").filter({
    has: page.getByRole("heading", { name: `${slug}.png`, exact: true }),
  });
  await file.getByRole("button", { name: "插入正文", exact: true }).click();
  await expect(page.getByLabel("MARKDOWN", { exact: true })).toHaveValue(
    /\/api\/v1\/public\/media\//,
  );
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }).first(),
  ).toBeVisible({ timeout: 10000 });
  const source = await page
    .getByLabel("MARKDOWN", { exact: true })
    .inputValue();
  const mediaId = source.match(/\/api\/v1\/public\/media\/([^\s)]+)/)[1];
  const publicMedia = await page.request.get(
    `${origin}/api/v1/public/media/${mediaId}`,
  );
  expect(publicMedia.status()).toBe(404);
  const privateMedia = await page.request.get(
    `${origin}/api/v1/admin/media/${mediaId}/content`,
  );
  expect(privateMedia.status()).toBe(200);
  checks.push("真实 PNG 上传、插入引用、公开媒体 404 / 私有预览 200");
  await page.getByRole("button", { name: "属性", exact: true }).click();
  await page.screenshot({
    path: new URL("editor-desktop.png", directory).pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "修订", exact: true }).click();
  const history = page
    .locator("aside")
    .filter({ has: page.getByText("IMMUTABLE HISTORY") });
  const versions = history.getByRole("button").filter({ hasText: "后台验证" });
  expect(await versions.count()).toBeGreaterThan(1);
  await versions.last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "恢复为新修订" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByLabel("MARKDOWN", { exact: true })).toHaveValue("");
  checks.push("历史预览与恢复生成新修订");
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("MARKDOWN", { exact: true })
    .fill("## 移动写作\n\n真实私有草稿。");
  await expect(
    page.getByRole("status").filter({ hasText: "已保存" }).first(),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "属性", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: new URL("editor-mobile.png", directory).pathname,
    fullPage: true,
  });
  checks.push("390px 编辑器无横向溢出");
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.getByRole("button", { name: "站点设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "站点设置", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: new URL("settings-desktop.png", directory).pathname,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await writeFile(
    new URL("browser-report.json", directory),
    JSON.stringify(
      {
        origin,
        checkedAt: new Date().toISOString(),
        checks,
        pageErrors: errors,
        privateDraftUrl: draftUrl,
        privateMediaId: mediaId,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        pageErrors: errors,
        artifacts: directory.pathname,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({
    path: new URL("failure.png", directory).pathname,
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
