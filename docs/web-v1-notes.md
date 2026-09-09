# 公开站点与共享阅读包验证记录

2026-09-09。本记录只覆盖公开 Web、共享 Markdown、VFS/终端、UI 令牌；发布事务与后台端到端证据见主进度记录和 E2E 报告。

## 实现

- React 19.2.8、React Router 8.3.1 Framework Mode、Vite 8.2.2、TypeScript 7.0.2 strict、Zustand 5.0.15。CSS Modules 组织工作站外壳，全局 CSS Variables 是三个主题的唯一令牌来源。
- 正文使用语义 DOM、普通超链接、独立内容 URL。目录、搜索、标签、关于、近况、外部链接和独立 404 都已实现。没有默认为作者编造内容；无快照使用真正空站点。
- `HADESD_SNAPSHOT` 必须是绝对路径；配置与服务器 loader 从同一文件读取冻结内容。Root loader 只输出元数据，单篇 loader 单独输出 Markdown。未将全部正文打入首页 JavaScript。
- `HADESD_BUILD_DIR` 支持隔离构建。动态路由从快照显式枚举。空快照不会注册没有预渲染路径的内容 loader。所有固定页、单篇、标签输出 HTML 与 `.data`。
- React Router 8 的 `meta` 参数为 `loaderData`；已为实际文章输出 title、description、canonical、Open Graph。RSS、sitemap 与 robots 来自同一冻结快照。
- 真实静态文件服务器先解码 URL，所以 postbuild 同步归一化 React Router 输出的编码标签目录名与 `.data` 文件名为 Unicode。
- Markdown 共享包支持 GFM、表格、脚注、图片、锚点目录、复制代码、受限语言语法着色与 KaTeX 数学。拒绝原始 HTML、危险协议和协议相对链接；数学 `trust: false`、限制扩展次数。后台仅通过受控 `mediaUrl` 回调改写已识别的公共媒体路径。
- 终端使用 tokenizer、20 项命令注册表、公开 VFS、规范化路径与结构化 React 输出；无 Shell 执行能力。支持历史、草稿恢复、IME、多行编辑、显式补全菜单、取消、请求序号、cat 截断。`clear` 不清输入历史。阅读模式保留会话历史。
- 命令面板同时提供元数据匹配和显式全文搜索入口。鼠标、终端与面板使用相同公开路由及 VFS 内容映射。
- 目录列表按 20 条逐批显示；无 JavaScript 时 `noscript/details` 保留剩余全部链接。正文最大宽度 780px，代码与表格独立横向滚动。
- 原生 WebGL2 Shader 只负责黑色透明扫描线、暗角、低强度噪点；不采样 DOM。Low 闲置无 RAF；Full 上限 30fps；DPR ≤ 1.5、像素预算 ≤ 2,000,000。销毁、页面隐藏、尺寸变化、context lost、减少动态效果、强制颜色和打印都有处理。
- 打印样式移除导航、目录、终端、CRT、交互控件，保留标题、正文、必要链接。本文未宣称已完成实体打印机测试。

## 已运行的自动验证

全部命令退出状态为 0：

```sh
pnpm --filter @hadesd/terminal-core test      # 21 tests
pnpm --filter @hadesd/markdown test           # 4 tests
pnpm --filter @hadesd/web test                # 10 tests
pnpm --filter @hadesd/terminal-core typecheck
pnpm --filter @hadesd/markdown typecheck
pnpm --filter @hadesd/ui typecheck
pnpm --filter @hadesd/web typecheck
pnpm --filter @hadesd/web build              # EMPTY_SNAPSHOT
HADESD_SNAPSHOT=/absolute/frozen/snapshot.json HADESD_BUILD_DIR=/tmp/hadesd-web-verified pnpm --filter @hadesd/web build
```

35 条测试具体覆盖：危险 Shell 语法、引号/转义/Unicode、相对路径/根边界、鼠标/命令/面板目标一致性、补全、100 条历史边界、clear、长 cat、取消、未知命令、Markdown XSS、数学/重复标题锚点、媒体预览转换、IME Enter、普通 Tab 离开、编辑多行、20 条批次、Low RAF/像素/释放、Full context lost、无 WebGL 降级。搜索额外用真实未完成 Promise 模拟旧请求：清空查询会 Abort，加载态及时消失，旧响应不能覆盖清空状态。

在隔离目录实际检查了冻结示例内容构建产物：

- `posts/welcome-to-hadesd/index.html` 含完整中文正文。
- 文章 `<title>` 为「欢迎来到 hadesd.sh — HADESD」。canonical 为 `https://hadesd.sh/posts/welcome-to-hadesd`。
- 首页 HTML 不含该文章正文特有句子。
- `tags/随笔/index.html` 与 `tags/随笔.data` 均存在。
- 当时隔离构建的首页必要外部 JS（HTML 引用及模块预加载去重后，含框架与 manifest）共 **115,666 bytes gzip ≈ 113 KiB**，未计 HTML/CSS，不等于整站全部 JS。最终发布站实际请求的测量为 **115,963 bytes gzip**，完整方法与分包清单见 [性能实测](performance.md)。Markdown/KaTeX 在独立阅读模块中，不属于首页依赖图。

## 已完成的真实浏览器检查

使用 CUA 的 Codex 内置浏览器访问 `http://127.0.0.1:5173`，输入同一份明确标注为示例的冻结快照，完成以下可见验证：

1. 桌面首页：导航、可点击目录、真实文章列表、品牌图形、空项目状态、底部终端。
2. 鼠标点击文章：独立 URL、标题、目录、正文、标签、永久链接正常；目录状态变为 `~/posts`。
3. 点击代码复制后显示「已复制」。
4. 切换专注阅读：侧栏、终端与 CRT 隐藏，正文居中，保留「返回完整界面」。
5. 打开显示设置和命令面板；按「欢迎」过滤到同一篇公开文章。
6. 真正输入 `help → ls → cd posts → ls → open welcome-to-hadesd.md`，导航到与鼠标相同的文章。
7. 临时 390 × 844 视口：单列、目录抽屉入口、终端默认折叠；无横向溢出、无自动输入焦点。检查后已恢复默认桌面视口。
8. 所检查时段读取浏览器 error/warn 日志为空。

上述桌面首页、阅读模式、移动首页截图已通过 CUA 内联展示；生产静态站的可下载截图由主任务独立 Playwright 验证保存到 `.local/reports/screenshots/`。本记录不将开发浏览器检查等同于生产 CSP、无 JavaScript、真实 GPU 或发布一致性验收。

## 实际取舍

- 代码高亮为小型受限语言规则；未知语言保留纯文本，没有引入整个语法语言库。
- `extractHeadings` 覆盖常见 ATX/Setext 标题、重复标题、代码围栏；极复杂内联标题组合未单独建立穷举测试。
- 已通过 Chromium/SwiftShader 实测帧率与生命周期预算；软件渲染不等于物理 GPU、真实手机耗电或持续热负载验收。详见 [性能实测](performance.md)。
- 无专门开机动画，不阻塞初始内容，也没有伪造运行时遥测。

开发期间批量格式化并修改路由导出时，Vite/React Router 的 HMR 曾在开发服务器输出 `No module update found for route`。重新加载页面后，交互与静态构建均正常；该日志不应被误写成“整个开发过程没有任何错误”。正式发布产物不含 HMR，生产浏览器控制台结论以主任务的静态站 E2E 为准。临时 5173 开发进程与 CUA 标签页在检查后已关闭。


## 静态首屏 hydration 回归修复

真实部署 E2E 揭示了 React Router 8.3.1 的构建行为：`createRouteRequest` 给所有预渲染请求追加尾斜杠。先前 `cwdForRoute` 严格比较 route，导致服务端 `/posts/article/` 回退根目录，而客户端 `/posts/article` 展开文章目录；两者子 DOM 不同，触发 React #418。

修复在 VFS 路由映射边界对两边执行路径规范化，并安全解码 Unicode。未使用 `suppressHydrationWarning`，没有关闭预渲染。新增 5 个根因路径用例和一个实际 `renderToString('/posts/article/') → hydrateRoot('/posts/article')` 测试；后者同时验证持久化 Paper 偏好恢复而不触发 `onRecoverableError`。

独立 `NODE_ENV=development` 冻结构建用于显示完整错误 diff。修复后使用真实 Chromium 对该静态产物执行：直接打开文章 → 调用真实 `WEBGL_lose_context.loseContext()` → Paper → 重新加载。结果 `contextLossInvoked: true`、`errors: []`、`paperRestored: true`；目录提示符保持 `~/posts`。发布站的同一场景另由主任务 E2E 重跑。

另为隔离构建设置 `build.emptyOutDir: true`：Vite 默认不清理项目之外的输出目录，反复构建会残留旧路由并导致中文标签文件归一化冲突。现在每轮清空各自的生成目录，重复外部构建已通过。

构建预览监听地址固定为 `preview.host: '127.0.0.1'`，保证容器中静态预渲染请求与临时预览服务器使用同一 IPv4 回环地址，避免 `localhost` 优先解析 `::1` 导致 `ECONNREFUSED`。容器重建验证由后端/部署任务执行。


## CRT 切档实测修复

最终性能采样发现 Low → Full 不能启动动画：之前 `destroy()` 主动调用 `WEBGL_lose_context`，而 React 在切换效果参数时复用 canvas，重建 renderer 得到已丢失的 context。真实浏览器对照中，切 Full 后 draw 总数一直为 2。

现保留资源解绑、buffer/program/shader 删除、RAF/observer/事件清理，移除正常生命周期里的主动 context loss。真实 context lost 故障降级保持。新增使用会丢失 context 的模型进行 StrictMode 与 Low → Full → Off 组件回归，明确验证绘制启动、Off 停止、资源释放。性能实测数据见 `docs/performance.md` 与 `.local/reports/performance.json`。
