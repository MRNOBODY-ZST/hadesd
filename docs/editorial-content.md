# 阅读站内容与编辑依据

## 本轮内容分类

- **用户确认的信息**：名称 Hades；hadesd.sh 终端站与 itshades.dev 阅读站；共用后端；希望先发布博客研发内容。没有学校、职业、所在地、联系方式或个人经历资料。
- **源码可核实的内容**：`content/development/01–04` 的四篇项目说明，分别对应 `apps/web`、`apps/journal`、`backend`、`apps/publisher` 和 `infra` 等实现。正文以保存、阅读、发布、恢复等具体问题展开，用比喻解释概念，保留技术边界，不改写成作者经历。心跳间隔和租约期限等数字是代码参数，不是实测成绩。
- **上一轮生成的编辑文字**：首页广告语、关于与近况页的第一人称判断不是用户原文。本轮替换为客观的内容范围和使用说明。
- **演示素材**：`scripts/demo.mjs` 的示例及验收草稿仅用于隔离测试；原首页的 AI 拼贴和 CSS 设备图是装饰，不是真实项目照片。本轮不再展示，素材保留以便追溯。

四篇研发文章是基于代码整理的项目文档，不是虚构的摄影、生活或职业作品。没有新增凑数量的文章。关于页统一说明这一性质；后续作者自己的文章无需套用这段说明。

## 后续维护

阅读站名称与首屏内容说明集中在 `apps/journal/app/site.ts`。新增实际主题后再修改说明，不预先列出摄影或随笔。文章标题、摘要、标签和正文来自同一公开快照；首页按发布时间列出最多六项，有多少展示多少，不按 slug 或位置编造专题。

现有文章可在后台编辑；本内容包的 Markdown 在 `content/development/`。不要用导入器覆盖后台新增的作者修订：先导出并比较当前版本，只把确定要替换的内容纳入导入。上线使用 `scripts/publish-development.mjs --apply`：先备份现有内容、设置和修订，再通过正常后台 API 保存修订和发布；不直接改数据库。

## 四张讲解图

`content/development/images/` 保存双站架构、终端显示路径、发布切换和备份范围四张原创示意图的 SVG 与 PNG。它们依据源码概括流程，不是实际运行截图或测试报告；正文图注说明省略项和适用范围。所有图都有替代文字和查看原图入口。

编辑 `scripts/render-development-diagrams.mjs` 后运行 `node scripts/render-development-diagrams.mjs` 可重新渲染，需要 Playwright Chromium 和中文系统字体（如 PingFang SC 或 Noto Sans CJK SC）。图片由两个前端共用的 SEO 构建步骤复制到 `/editorial/`，不依赖第三方图床。修改已发布图时使用新版本文件名，并保留旧文件，以便旧修订和回滚仍能找到图片。

预览更新后的内容：

```sh
node scripts/publish-development.mjs --snapshot .local/editorial/snapshot.json
HADESD_SNAPSHOT="$PWD/.local/editorial/snapshot.json" pnpm dev:journal
HADESD_SNAPSHOT="$PWD/.local/editorial/snapshot.json" SITE_ORIGIN=https://itshades.dev pnpm --filter @hadesd/journal build
```

日常写作继续使用原有后台、修订与发布流程。本文不是 MDX / Next.js 迁移方案；已有 `/posts`、标签和搜索路由保持不变。
