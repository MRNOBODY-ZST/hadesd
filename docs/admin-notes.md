# 管理后台实现与验证

## 范围与入口

独立 React / TypeScript strict / Vite SPA，构建路径 `/admin/`。样式采用 CSS Modules 和 CSS Variables，写作台使用 Paper、墨绿与少量琥珀色。后台与公开站点分开构建，Markdown 编辑器按需加载。

- 本地统一入口：`http://127.0.0.1:18088/admin/`（先按根 README 启动依赖、后端与本地静态服务）。
- 热更新开发：`pnpm --filter @hadesd/admin dev`，访问 `http://127.0.0.1:5174/admin/`。`/api` 代理至 `API_ORIGIN`，默认 `http://127.0.0.1:28080`。
- 构建：`pnpm --filter @hadesd/admin build`。

## 已实现的工作流

1. Session 表单登录。写请求获取并携带 CSRF；登录、退出后重新获取 CSRF。浏览器仅保留 HttpOnly 会话 Cookie，前端不存储认证令牌。401 写响应显示重新登录界面；保留仍挂载的本地编辑器。API 请求 15 秒超时后显示可重试错误。
2. 文章、项目、研究、页面的分页列表、当前页类型与标题筛选、新建、编辑；PAGE 路径遵从后端只允许 `about` / `now` 的约束。
3. Markdown 编辑 / 分屏 / 私有预览；共用 `@hadesd/markdown` 的 GFM、数学、代码与清洗规则。媒体持久化引用 `/api/v1/public/media/{id}`，预览时映射到鉴权私有接口；不把私有 URL 写入正文。
4. 1.2 秒 debounce 自动保存，另有“立即保存”。单次只允许一个保存请求在途，保存途中输入的文字会在旧请求完成后使用返回的新版本继续保存。
5. `version` 乐观锁。`REVISION_CONFLICT` 停止自动保存、保留本地文字，展示服务器文字，支持明确选择载入服务器版本或以当前文字创建新修订。网络失败停止隐式重试，未保存状态继续触发离开保护。
6. 修订历史分页、读取与预览。恢复会 POST 新修订，历史不可变。预览使用原生 `dialog.showModal()`，支持焦点约束、Esc 关闭与返回触发按钮。
7. 标签、语言、摘要、封面；图片与 PDF 上传、列表、私有预览、复制公开引用、删除。客户端校验 MIME 与实际文件长度，真正的文件特征与引用保护由后端再次验证。
8. 显式选择 `revisionId` 发布、撤稿、初始化空站点、发布站点设置、历史发布回滚。任务轮询区分等待 / 构建 / 就绪 / 部署 / 上线 / 失败；失败重试保留原来的完整 PublishRequest，包含明确的修订 ID。会话存储仅记最近任务 ID 和提交参数，以便刷新后继续查看进度。
9. 站点简介、首页文字、导航、外部链接；保存与发布分离，`SETTINGS` 冻结当前在线内容与已保存设置。不添加虚构个人资料、外链或计数。
10. 编辑器与设置页具有应用内导航、浏览器刷新 / 关闭的未保存保护。桌面与 390px 移动视口经过真实 Chromium 检查。

## 文件结构

- `apps/admin/src/api.ts`：统一请求、认证、CSRF、错误、端点与媒体路径。
- `apps/admin/src/store.ts`：Zustand 界面导航、dirty / pending 状态与最近发布任务。
- `apps/admin/src/features/useRevisionEditor.ts`：保存串行化、debounce、冲突与恢复行为。
- `apps/admin/src/features/Editor.tsx`：编辑、共享 Markdown 预览与属性 / 修订 / 媒体侧栏。
- `apps/admin/src/features/{Contents,MediaLibrary,Publishing,Releases,Settings}.tsx`：各能力边界。

## 锁定版本

React / React DOM 19.2.8；Vite 8.2.2；TypeScript 7.0.2；TanStack Query 5.102.8；Zustand 5.0.15；Vitest 5.0.0；Testing Library React 16.3.3；user-event 14.6.7；jsdom 27.4.0。精确依赖见 `apps/admin/package.json` 和根 `pnpm-lock.yaml`。构建配置与轮询签名核对了 [Vite base 文档](https://vite.dev/config/shared-options.html#base) 与 [TanStack Query useQuery 文档](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)。

## 实际验证

`pnpm --filter @hadesd/admin typecheck`：退出 0。

`pnpm --filter @hadesd/admin test`：3 个测试文件、10 个断言场景通过。覆盖 debounce、在途保存期间继续输入、409 保护与显式合并、历史恢复生成新修订、写失败保留 dirty、CSRF 登录退出轮换、multipart 边界、服务端 Problem Details、上传 MIME / 大小 / 空文件。

`pnpm --filter @hadesd/admin build`：退出 0。后台入口 JS gzip 约 79 KB，按需加载的 Markdown 编辑器 JS gzip 约 140 KB；其余媒体 / 设置 / 发布模块各约 1.5–2.2 KB gzip。精确字节和 chunk 名见 `apps/admin/artifacts/build.log`。该体积不属于公开首页的首屏包。

`node --env-file=.env apps/admin/scripts/browser-check.mjs`：连接真实 MySQL / Reactive 后端和 18088 同域服务，通过 6 组检查，浏览器 `pageErrors=[]`。真实完成登录、创建草稿、自动保存、刷新读取、标签、共享数学与安全 Markdown、PNG 上传与引用、公开未发布媒体 404 / 私有媒体 200、恢复历史新修订、390px 无横向溢出。

报告：`apps/admin/artifacts/browser-report.json`。截图：`login-desktop.png`、`contents-desktop.png`、`editor-desktop.png`、`editor-mobile.png`、`settings-desktop.png`。已逐张视觉检查；编辑器预览已显式配置 Paper 令牌，正文、表格、代码、数学与小屏滚动正常。

该浏览器脚本只创建名称含“后台验证”的独立私有 QA 草稿与 PNG 媒体，不发布它们、不改动示例与站点设置。账号密码由根 setup 创建的受限文件读取，不进入测试输出。完整发布 / 撤稿 / 回滚闭环的验证由根 E2E 套件承担，以上检查不声称代替发布 Worker 验证。

`node --env-file=.env apps/admin/scripts/browser-conflict-check.mjs`：在前一条脚本创建的私有 QA 草稿上，通过 4 组额外真实浏览器检查，`pageErrors=[]`：两个窗口触发真实 409、保留并比较双方文字后创建新修订；无效输入暂停保存、取消离开时保留编辑器；修订弹窗 Tab / Shift+Tab 循环、Esc 和焦点恢复；退出后 `/auth/me` 返回 401 并回到登录页。报告为 `apps/admin/artifacts/browser-conflict-report.json`，冲突截图为 `conflict-desktop.png`。在原生 `showModal()` 的 inert 行为之外，另做显式 Tab 首尾循环，避免键盘焦点在弹窗边界移向浏览器 chrome。
