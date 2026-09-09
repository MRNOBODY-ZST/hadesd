import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const directory = new URL("../artifacts/", import.meta.url);
const report = JSON.parse(
  await readFile(new URL("browser-report.json", directory), "utf8"),
);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1040 },
});
const first = await context.newPage();
const errors = [];
first.on("pageerror", (error) => errors.push(error.message));
const checks = [];
const runId = Date.now();
try {
  await first.goto(report.privateDraftUrl);
  await first
    .getByLabel("用户名", { exact: true })
    .fill(process.env.ADMIN_BOOTSTRAP_USERNAME || "hades");
  await first
    .getByLabel("密码", { exact: true })
    .fill(
      (
        await readFile(process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE, "utf8")
      ).trim(),
    );
  await first.getByRole("button", { name: "进入写作台 →" }).click();
  await expect(first.getByLabel("MARKDOWN", { exact: true })).toBeVisible();
  const second = await context.newPage();
  second.on("pageerror", (error) => errors.push(error.message));
  await second.goto(report.privateDraftUrl);
  await expect(second.getByLabel("MARKDOWN", { exact: true })).toBeVisible();
  await first
    .getByLabel("MARKDOWN", { exact: true })
    .fill(`## 主窗口的新修订\n\n来自窗口 A 的文字。${runId}`);
  await expect(
    first.getByRole("status").filter({ hasText: "已保存" }).first(),
  ).toBeVisible({ timeout: 10000 });
  await second
    .getByLabel("MARKDOWN", { exact: true })
    .fill(
      `## 保留下来的想法\n\n来自窗口 B 的文字，发生冲突时必须保留。${runId}`,
    );
  await expect(
    second.getByRole("heading", { name: "另一处修改先抵达了服务器" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(second.getByLabel("MARKDOWN", { exact: true })).toHaveValue(
    /来自窗口 B/,
  );
  await second.getByText(/查看服务器版本 v/).click();
  await expect(
    second.locator("pre").filter({ hasText: "来自窗口 A" }),
  ).toBeVisible();
  await second.screenshot({
    path: new URL("conflict-desktop.png", directory).pathname,
    fullPage: true,
  });
  await second.getByRole("button", { name: "以当前文字创建新修订" }).click();
  await expect(
    second.getByRole("status").filter({ hasText: "已保存" }).first(),
  ).toBeVisible({ timeout: 10000 });
  await expect(second.getByLabel("MARKDOWN", { exact: true })).toHaveValue(
    /来自窗口 B/,
  );
  checks.push("真实双窗口乐观锁409，双方文字可比较，显式创建新修订");
  const originalSlug = await second
    .getByLabel("永久链接标识", { exact: true })
    .inputValue();
  await second.getByLabel("永久链接标识", { exact: true }).fill("");
  const prompt = second.waitForEvent("dialog");
  const leaving = second
    .getByRole("button", { name: "内容手记", exact: true })
    .click();
  const confirmation = await prompt;
  expect(confirmation.message()).toContain("未保存");
  await confirmation.dismiss();
  await leaving;
  await expect(second.getByLabel("MARKDOWN", { exact: true })).toBeVisible();
  expect(second.url()).toBe(report.privateDraftUrl);
  await second.getByLabel("永久链接标识", { exact: true }).fill(originalSlug);
  await expect(
    second.getByRole("status").filter({ hasText: "已保存" }).first(),
  ).toBeVisible();
  checks.push("无效输入暂停自动保存，离开脏页确认取消后保留编辑器");
  await second.getByRole("button", { name: "修订", exact: true }).click();
  const history = second
    .locator("aside")
    .filter({ has: second.getByText("IMMUTABLE HISTORY") });
  const revisionButton = history
    .getByRole("button")
    .filter({ hasText: "后台验证" })
    .first();
  await revisionButton.click();
  const close = second.getByRole("button", { name: "关闭历史修订" });
  await expect(close).toBeFocused();
  await second.keyboard.press("Shift+Tab");
  await expect(
    second.getByRole("button", { name: "恢复为新修订" }),
  ).toBeFocused();
  await second.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await second.keyboard.press("Escape");
  await expect(second.getByRole("dialog")).not.toBeVisible();
  await expect(revisionButton).toBeFocused();
  checks.push("原生修订弹窗焦点陷阱、Esc关闭与焦点恢复");
  await second.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    second.getByRole("heading", { name: "回到写作台", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  expect(
    (await second.request.get(`${report.origin}/api/v1/auth/me`)).status(),
  ).toBe(401);
  checks.push("真实退出登录清除服务器Session并回到登录页");
  expect(errors).toEqual([]);
  await writeFile(
    new URL("browser-conflict-report.json", directory),
    JSON.stringify(
      { checkedAt: new Date().toISOString(), checks, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, pageErrors: errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
