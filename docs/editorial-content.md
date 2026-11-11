# 内容依据与维护

## 当前公开文章

`content/development/hadesd-story.md` 是《我是如何从零开始开发 HADESD 的》的源文。它替代原来的架构、终端、发布和自托管四篇文章。旧 Markdown 可从 Git 历史恢复；线上旧稿通过撤稿和回收站保留修订，不永久删除。

文章按项目实际变化展开，保留少量解释性比喻，不编造私人经历、读者反馈或性能成绩。第一人称只用于用户在开发对话中明确表达的需求、判断和反馈。项目由用户与 Codex 协作完成，正文明确交代这一点。

## 核对依据

- 最初的产品构想：`docs/source-requirements.md`。它是历史需求，其中固定布局、无开场、无公众账号等要求后来有过调整，不能直接作为现状说明。
- 早期开发对话「使用 Spring Boot Reactive 开发」：已阅读可用历史中的初版要求、固定终端、飞机／太空方向纠正、Mac 与 80% 加载节奏、滚动历史、账号交互、后台管理及前景试验。只提炼项目过程，不复制对话里的凭据、私有地址和运维连接信息。
- 后续对话「重写项目README」及「生成博客提示词」：自托管、README 与 GIF、第二个域名、Apple 风格反馈、内容删减，以及由四篇技术说明改为一篇项目回顾。
- 实现与交付记录：`docs/decisions.md`、`docs/crt-journey.md`、`docs/terminal-scroll-validation.md`、`docs/admin-management.md`、`docs/deployment.md`、`docs/self-hosting.md`、`docs/dual-frontends.md`。
- 提交节点：`886fc4b` 首次公网交付、`a4c7851` 经典 Mac 与私有媒体、`49b3f03` 滚动终端与文字账号流程、`cded8f4` 后台管理、`6b4eb7a` 滚筒遮挡修复、`1f082a3` 自托管与演示、`c7ba0ff` 双前端、`b0c9094` 文案整理。提交日期只作核对依据，不据此编造实际工作时长。

文章没有把仅在本地试验的前景入口写成默认生产功能，也不把历史测试数量转写成本次全部通过的证明。

## 配图

`content/development/images/` 中：

- `story-mac-v1.png`：项目留存的 2026 年 9 月 Mac 场景截图，原始文件为 `.local/drum-v12/live-hero.png`。
- `story-ascii-v1.png`：同批字符滚筒截图，原始文件为 `.local/drum-v12/live-4-0.55.png`。
- `story-journal-v1.png`：本次内容整理后的普通阅读站构建预览，匿名浏览器截图。

本轮补充五张原始历史截图：`story-first-home-v1.png`、`story-flight-v1.png`、`story-dos-v1.png`、`story-terminal-history-v1.png` 和 `story-admin-qa-v1.png`，分别来自 `.local/reports/screenshots/` 与 `.local/reports/terminal-blog-v2/`；后台和终端画面均为隔离测试示例。图片是实际项目画面，没有用生成图重建历史。原四篇的 SVG / PNG 示意图继续保留，供已有修订和回滚使用；它们不再作为当前文章配图。`scripts/render-development-diagrams.mjs` 只维护这些历史示意图，不会重制截图。

两个前端共用的构建步骤将图片复制到 `/editorial/`。更新已发布图片时使用新文件名，保留旧文件。正文使用替代文字与原图入口。

## 写作与发布

名称与首页说明在 `apps/journal/app/site.ts`。新增真实主题后再调整，不预先列出不存在的摄影、作品或随笔。

日常写作使用后台。仓库内容包导入前必须比较后台最新修订，避免覆盖作者后来新增的文字。`scripts/publish-development.mjs` 默认只生成计划；`--apply` 会先备份内容、修订和设置，再正常保存发布。

只有明确传入 `--replace-development-series`，才会在新文章和固定页发布成功后撤下原四篇 POST，并移入回收站。普通导入不会自动删除其他文章。

预览：

```sh
node scripts/publish-development.mjs --snapshot .local/editorial/snapshot.json
HADESD_SNAPSHOT="$PWD/.local/editorial/snapshot.json" pnpm dev:journal
```

本次文章沿用八张已发布的过程截图，新增的 `terminal-demo-v1.gif` 是仓库 `docs/assets/terminal-demo.gif` 的原样副本，录制自真实界面，使用示例数据并关闭 GPU CRT。
