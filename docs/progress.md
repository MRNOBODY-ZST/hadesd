# 实施与验收证据

## 生产部署（2026-09-10）

公网入口已部署为 [hadesd.sh](https://hadesd.sh)，后台为 [/admin/](https://hadesd.sh/admin/)。网站在内网服务器编译运行，VPS Nginx 沿现有 WireGuard 反代；数据库、Redis 和后端没有公开映射端口。完整运行路径和操作见 [deployment.md](deployment.md)。后续各节为不同版本的历史验收记录。

本次迁移保留已有管理员、文章、草稿和附件，以当前冻结快照重新构建，最终公开版本为 **`c7928cf3-95d0-4b3f-bfb2-7b25298a66e6`**。除版本 ID 与创建时间外，公开内容与设置和迁移前完全相同。最新静态构建在服务器用时 18.245 秒，发布 API、静态 `release.json` 与源站 current 一致；临时构建代理已移除，发布成功不依赖它。

生产反代测试发现并修复了未解析客户端地址的空指针；读取 host 文本不会触发阻塞 DNS。发布器配置 6 GiB 容器内存和 4096 MiB Node 堆，并保留安全的退出码、信号与耗时诊断。浏览器会话刷新与登录、退出、改密已串行，避免旧会话响应干扰新的 Cookie；E2E 等待用户可见登录成功后才检查 API，不在登录轮换期间并发轮询共享 Cookie。

| 本轮检查 | 实际结果 |
| --- | --- |
| 后端 | 22 / 22 通过，bootJar 成功，包含真实 Spring 转发头 IPv4 / IPv6 回归 |
| 会话修复 | Web 全部 62 项测试、类型检查通过；新增 6 项请求顺序、失败恢复与取消回归 |
| 发布器 | 5 项现有测试、真实构建子进程及生产 Compose 配置检查通过 |
| 公网接口 | HTTPS、HTTP 跳转、后台登录/退出、Secure Cookie、搜索、内部与私有路径访问限制、HTTPS sitemap 共 8 项通过 |
| 生产浏览器 | 文件、评论附件、权限和真实 Full CRT / Tab / 连续翻屏 4 项首轮通过；账号用例修正测试时序后通过，最终会话修复版再次单项通过。两次登录期间触发 focus，后台 session 请求均等到登录读取身份完成后才发送；未宣称一次全套通过 |
| SSL | Let's Encrypt，检查时到期 2026-12-08；certbot.timer 已启用，续期 dry-run 与 Nginx 部署钩子分别通过 |
| 最终备份 | 停止 backend / publisher 写入后，`/srv/hadesd/backups/20260909T190322Z` 完成数据库、媒体、发布目录与私有配置备份；数据库及 current 清单 SHA-256 校验通过。该记录为备份校验，不是生产恢复演练 |

原有 K3s 与 VPS 现有服务保持运行；本轮测试评论和文件已清理，所有测试账号的公开评论残留为零。生产证据位于私有 `.local/reports/production/` 和 `.local/reports/production-blog-2026-09-10/`；不提交凭据、数据库转储、私有上传文件或浏览器运行产物。

## 本地博客功能版（历史验收）

> **博客功能版已在本地发布。** 类型检查、121 项单测、20 项后端测试通过；22 项完整 E2E 通过，最终折叠显示修复后另有 6 项公开交互复测与 5 项实际 Markdown 视觉检查通过。下方 v4.1 / v4 / v3 等图形与性能记录为历史结果，不代表本轮重新测量。使用方法见 [blog.md](blog.md) 与 [markdown-guide.md](markdown-guide.md)。

## 博客功能与终端交互（2026-09-10）

读者注册、登录、退出、资料和密码管理、私有文件上传下载、Markdown 评论与一层回复、本人编辑删除、管理员评论管理已接入真实 WebFlux / R2DBC / Redis 后端。V4 数据迁移保留既有管理员和文章。作者附件支持选择、拖放和粘贴，并在上传期间保留后续编辑；高级 Markdown 包含语法高亮、KaTeX、GFM 脚注与表格、安全提示与折叠块、按需 Mermaid。

Tab / Shift+Tab 支持命令、路径和参数补全，Ctrl+Space 显示候选；修复受控输入旧 selection 事件清除补全状态的竞态。PgUp / PgDn 在命令框中可连续翻屏并保留草稿，分页按钮无需重新点选 Section。账号参数不进入显示历史。HTTPS 图片通过独立原生层显示并按终端分页裁剪；关闭的折叠块在文字与图像捕获中均不绘制。

| 本轮验证 | 实际结果 |
| --- | --- |
| 类型检查与单测 | 全仓类型检查通过；121 / 121 单测通过；后端 20 / 20，无跳过 |
| 完整 E2E | 22 / 22 通过，284.45 秒；含新增 5 项博客和原有 17 项，0 失败 / 跳过 / 重试 |
| 最终显示修复复测 | 6 / 6 公开交互复测通过，39.21 秒；没有重复注册和发布操作 |
| 真实渲染 | 1440×900 与 390×844，Full WebGL2；5 项图像 / Markdown / Mermaid 检查通过，零页面错误。折叠块关闭→展开→关闭实际 Canvas 绘制记录和截图正确 |
| 数据保护 | 迁移前备份完成；V4 备份隔离恢复通过，新增表全部存在，29 个媒体文件和 1617 个发布文件校验成功 |

最终公开版本为 **`2ccbf7f6-ae4e-4411-8783-22963f9b6174`**。完整证据位于 `.local/reports/blog-v1/completion.json`，原有公开内容已恢复。首次 E2E 的 Tab 竞态、代理头重复失败证据保留于 `first-run/`；两个视觉探针脚本定位 / 数学语法修正以及折叠修复前截图分别归档，未混入最终通过记录。最终截图等待实际 GPU 帧更新，避免将 DOM / 原生图片先更新而纹理尚未绘制的瞬间当作完成画面。

本轮没有重测历史性能数字。受控 HTTPS 图像测试验证显示行为，不验证第三方图床可用性；恢复时用户文件和评论附件引用表已被 E2E 清理为空，逐文件验证对应现存媒体与发布文件。完整功能和证据边界详见 [blog.md](blog.md)。

## Terminal v4.1 ASCII 过渡、连续投影与阶段同步

本轮完成暗色 Mac Face / 亮色 ASCII 场、Skyworks 圆柱屏幕算法适配、不透明深度边界、27.5% 连续 UV 交接，以及穿屏结束时的阶段同步。八阶段节奏、固定终端、公开业务、SSR 与 Reactive 后端沿用既有契约。下面仅记录本轮实际结果，v4 正式记录完整保留在后方。

| v4.1 验证范围 | 当前实际记录 |
| --- | --- |
| 全仓类型检查 / 单测 / diff 检查 | **通过，69 条单测，命令退出 0**：publisher 5、Markdown 4、terminal 21、admin 10、web 29；包含源图比例 / 交接 UV 两条几何回归和 React 提交前的阶段同步回归 |
| 真实发布与完整业务 E2E | **17 / 17 通过，0 失败 / 跳过 / flaky，236.100 秒（约 3.9 分钟），命令退出 0**；报告及阶段 journal 位于 `.local/reports/terminal-v4-1/e2e-final/`，完整 HTML 为 `.local/reports/playwright/index.html` |
| 同帧交接与手机交互 | **E2E 通过**；27.49% → 27.51% → 27.49% → 27.51% 全部保持 DOM 整数 27，实际 Mac / 首格严格互斥；中段停留 / 反向 / 返回通过。手机真实触屏停在约 49%，GPU 进度稳定后 4 个元件可见，原 >=3 阈值保留 |
| 独立生产 WebGPU 与手机交接 | **通过**；WebGPU 八阶段 / reveal 0–7、0 错误。142 个实际 GPU 帧中，12 个穿屏帧的进度和屏幕 z 单调前进、alpha 单调降至 0，reveal 中旧 DOS / Mac / 滚筒可见数为 0。手机 9 点交接与反向同整数 27% 严格互斥通过；证据 `webgpu-result.json`、`webgpu-gpu-frames.json`、`handoff-mobile-webgl.json` |
| ASCII、投影接缝与最终视频 | **通过**；28.76 秒原始录屏完整展示八阶段、单右眼眨眼、暗 Mac / 亮字符场与七批终端。尾段 169 帧蓝色 DOS 重入为 0，直接视觉检查无闪回、无新增比例突变或工作台透底。报告 `.local/reports/terminal-v4-1/production-recording.json` 为 PASS，pageerror / console error 均为空 |
| 性能、包体积与资源释放 | **16 / 16 检查通过**；稳定终端 Full **27.25 帧/秒**（任意 1 秒最多 29 帧）、Low **2.00 帧/秒**且 CSS 扫描动画关闭；Off 画布 / 管线帧 / RAF 均为 0。完整首页 JS **548.25 KiB gzip**（561,404 字节），Off 基础 **115.30 KiB**，GPU 追加 **432.95 KiB**；完整版本超过旧 300 KiB 目标。报告 `.local/reports/performance.json` 和 [performance.md](performance.md) |

阶段同步修正版首次发布为 `3b15df97-0392-482e-95f7-4d8b61204f17`。E2E 完成真实写作、发布、修改隔离、撤稿与回滚后恢复原公开内容，最终公开版本为 **`65767226-6344-46a6-84d5-a4d155e270ee`**；前三项 CMS 完成至全套结束保持不变。专项证据统一位于 `.local/reports/terminal-v4-1/`。

源码已核对 Skyworks 固定提交的五列 × 16 屏幕、中央编号 12 接 DOS、不透明圆角边界写深度、约 20 物理像素方格与手机至少 48 列 / 40 行。Mac / 首格通过共享 UV 与 27.5% 同帧互斥保持比例；`phaseState` 和 `phaseProgress` 在渲染帧中同步读取，避免 React 上一阶段搭配已归零进度而使 DOS 回闪。结构与单测支持实现判断，最终像素画面仍按独立视频报告记录。

最终视频为 `.local/reports/terminal-v4-1/hadesd-v4-1-preview.webm`：**28.76 秒**、1440×900、VP8 / 25fps、8,281,561 字节，未剪辑或变速。录制操作耗时 27.718 秒与视频容器时长分别记录；录制前后 release 均为 `65767226-6344-46a6-84d5-a4d155e270ee`。离线审核包含完整关键帧、交接与眨眼密集帧、169 个尾段帧的蓝色重入检查及直接视觉核对，确认 DOS 退场后按七组进入终端，没有再次出现。

最终性能采样于 `2026-09-09T14:07:29.048Z` 完成，首尾 release 均为 `65767226-6344-46a6-84d5-a4d155e270ee`。独立旅程停驻在 p=0.5 的 5.038 秒内输出 93 帧，即 **18.46 帧/秒**（任意 1 秒最多 20 帧）；真实 ASCII 网格显示，4 个硬件中心位于视锥，进度前后为 0.5，文字捕获为 0、错误为空。该采样不代表连续滚动片头的帧率，也没有单独隔离硬件绘制耗时。终端 Full / Low 闲置捕获均为 0，输入与翻屏各触发 1 次捕获 / 1 帧输出。Low 仍有 Three 内部 RAF（采样期 264 次），不能称为零调度。

计时后端为 WebGL2 / SwiftShader，独立 WebGPU 也使用软件适配器。测量浏览器与 E2E / 录屏按顺序关闭，但用户的 Edge 页面保留，因此不声称整机隔离或物理 GPU / 手机耗电性能。体积是 JavaScript 响应体逐文件离线 gzip 估算，不包括 CSS、字体与图片；CSS 合成开销未计入 Three 帧计数。

修正前证据完整保留：`pre-aspect-fix/e2e/` 为首轮 16 / 17，手机测试在元件离场帧取样，现改为真实触屏稳定停驻；`pre-phase-fix/e2e/` 为 UV 修正版的 17 / 17（267.498 秒），随后原始录屏发现约 0.32 秒的 DOS 回闪。保留原片和诊断帧，未剪辑掩盖。当前 69 单测与 236.100 秒 E2E 属于修复后的新版本。v4 历史 E2E 另存于 `.local/reports/terminal-v4/e2e-final/`。

## Terminal v4 正式实施与验收（v4.1 改动前）

- 已实现 `boot → pullback → hero → journey → resume → penetrate → reveal → terminal`：DOS 约 2.6 秒至 80%，拉远约 2.2 秒后等待；滚动旅程到终点再约 1.3 秒续启、约 1.1 秒穿屏，七组终端内容依次出现后解除输入保护。
- `bootProgress`、用户旅程 `progress`、定时阶段 `phaseProgress` 与 `revealStep` 分别记录。旅程到 100% 仍不代表 ready；跳过、Off、减少动态效果与 GPU 失败直接显示全部终端，重启重置全部阶段。
- 使用真实 DOM 可见性控制七批内容，捕获根的属性变化触发文字纹理更新，不伪造逐批计数。保留内容 URL、搜索、鼠标与键盘命令、长文分页、SSR / 无 JavaScript 和 Reactive 后端。
- 本轮 E2E 已更新为记录八阶段、80% 保持、续启、七批可见性与 inert 状态，增加全部片头阶段的键盘跳过检查；原业务覆盖保留。以下分别记录本轮实际命令结果与独立视觉、性能报告。

| v4 验收 | 当前记录 |
| --- | --- |
| 全仓类型检查 / 单测 / diff 检查 | **通过**；66 条单测：publisher 5、Markdown 4、terminal 21、admin 10、web 26；最终 admin build 也已通过 |
| 真实发布与全量 E2E | **17 / 17 通过，0 失败 / 跳过 / flaky，242.154 秒（约 4.0 分钟）**；`pnpm test:e2e` 退出 0，原始 JSON 保留于 `.local/reports/terminal-v4/e2e-final/playwright.json` |
| 桌面 / 手机完整视觉与录屏 | **通过**；1440×900 / 390×844 无页面溢出，0 pageerror；八阶段、ASCII 眨眼、四类元件、DOS 80–100% 和七批终端显示已实际核对。后台轻度 CRT 覆盖与点击聚焦正常。原始录屏 **44.8 秒**，报告 `.local/reports/terminal-v4/production-capture.json` |
| WebGPU / WebGL2 / 故障回退 | **通过**；生产 WebGPU 独立记录八阶段、80% 保持、续启递增和 reveal 0–7，最终文字纹理 / 双主 RT / TSL 正常且电脑、ASCII 和元件全部隐藏；错误为空。WebGL2、禁用 GPU 与实际 context loss 已通过 E2E。证据：`.local/reports/terminal-v4/webgpu-result.json`、`webgpu-journal.json` |
| 性能、包体积与资源释放 | **16 / 16 检查通过**；稳定终端 Full **22.67 帧/秒**（任意 1 秒最多 25 帧），Low **2.00 帧/秒**且 CSS 扫描动画关闭；Off 画布 / 管线帧 / RAF 均为 0、玻璃层隐藏。完整首页 JS **547.66 KiB gzip**，Off 基础 **115.29 KiB**，GPU 追加 **432.37 KiB**；完整版本超过旧 300 KiB 目标。原始采样另存 `.local/reports/terminal-v4-performance.json` |

v4 首次正式发布为 `3a27bf41-8eea-41a9-a715-505985dcc246`。E2E 经真实写作、发布、修改隔离、撤稿与回滚后恢复原公开内容，结束时公开版本为 `e31a16a5-e9c6-4bc2-a280-ac1ebbdc0f31`；前三项业务测试完成后的只读检查期间，该版本保持不变。

正式视觉报告、独立 WebGPU 与性能采样前后的公开版本同为 `e31a16a5-e9c6-4bc2-a280-ac1ebbdc0f31`。性能采样跳过片头，仅计稳定终端的实际管线输出：Full / Low 闲置文字捕获均为 0，输入触发 1 次捕获 / 2 帧输出，翻屏触发 1 次捕获 / 1 帧输出；Low 的 4.502 秒内仍有 269 次 Three 内部 RAF 回调，不能表述为零调度。计时后端为 WebGL2 / ANGLE SwiftShader，独立 WebGPU 也使用软件适配器；这些结果不代表片头帧率、实体 GPU、手机耗电或 CSS 合成性能。体积按实际请求的 JavaScript 响应体逐文件离线 gzip 估算，不包括 CSS、字体和图片。

完整八阶段桌面录屏为 `.local/reports/terminal-v4/hadesd-v4-preview.webm`，1440×900、VP8、25fps、9,064,729 字节，播放时长 44.8 秒；录制脚本的操作用时 43.918 秒是另一项数据。保留原始顺序，没有剪辑或重定时。离线逐帧检查确认约 18.1 秒的右眼眨眼、DOS 从 80% 续启至 100%、穿屏后依次显示终端七组；手机电脑 / 键盘 / 鼠标和四类电子元件可辨认，后台玻璃层不拦截输入。另已在 Codex 原生内置浏览器打开正式站并直接查看 WebGPU 介绍画面。

首轮 15 项通过、2 项失败，原因分别为旧生命周期测试未跳过片头，以及 reboot 后仍按可访问角色查找已经 inert 的输入框。只更新测试入口和清空值的 DOM 定位，并为生命周期恢复加入 finally；产品未为旧断言改变行为。原报告、截图附件与 trace 保存在 `.local/reports/terminal-v4/e2e-first-run/`。通过真实回滚恢复初始公开内容后，完整重跑 17 项全部通过。

## Terminal v3 历史验收（原有结果）

- 已实现四阶段状态：约 3.2 秒 DOS 蓝色 CRT 开机后停在介绍画面；用户滚轮、触屏或键盘才推进镜头；途中可停止、反向；抵达终端后固定分页，`reboot` 重新从 DOS 开始。
- 当前场景为原创复古 Mac 风格电脑、键盘、ASCII 字符流、电容、0805 贴片电阻、QFP 微控制器与小 PCB。介绍文字围绕硬件与软件，不再使用飞机或星空主题。
- “进入终端”推进完整旅程，“跳过片头，进入终端”直接跳过；减少动态效果、CRT 关闭和 GPU 故障直接显示可用终端。手机不自动聚焦输入。
- 保留真实 DOM 文字采样、Three.js / R3F / WebGPU / WebGL2 / TSL、固定分页、中间输入光标、选区与 IME、公开路由和安全 Markdown；本轮未改变 Reactive 后端、后台写作或原子发布机制。
- v3 验收发布版本为 `97ff743d-24dc-44ad-8bcc-fc6068156d0d`，入口为本地真实发布站 `http://127.0.0.1:18088/`。以下保留该版本历史结果，完整说明见 [web-v3-notes.md](web-v3-notes.md)。

| v3 历史验收 | 当时记录 |
| --- | --- |
| 全仓 `pnpm typecheck && pnpm test && git diff --check` | 退出 0；**60 条单测通过**：publisher 5、Markdown 4、terminal 21、admin 10、web 20 |
| 真实发布站全量 E2E | **16 / 16 通过，0 失败，约 1.9 分钟**；在 18088 运行，覆盖新版片头、固定终端与既有业务 |
| 桌面与手机四阶段视觉 | **通过**；WebGL2 1440×900 / 390×844 无页面溢出、0 pageerror；电脑、键盘和鼠标完整，旅程中 6 个元件可见，最终回到可用终端。报告：`.local/reports/terminal-v3/production-capture.json` |
| WebGPU / WebGL2 / GPU 故障回退 | **通过**；两个实际后端均有文字纹理、双主 RT 与 TSL 输出，WebGPU 旅程中 ASCII 与 6 个硬件可见，终端阶段电脑 / ASCII / 硬件全部隐藏，错误为空。禁用 GPU 与实际 WebGL context loss 已纳入生产 E2E；WebGPU 证据：`.local/reports/terminal-v3/webgpu-stages.json` |
| 性能、包体积与资源释放 | **16 / 16 检查通过**；稳定终端 Full 约 25.08 帧/秒（任意 1 秒最多 27 帧），Low 约 2 帧/秒但仍有 Three 内部 RAF，Off 帧 / RAF / 画布均为 0。完整首页 JS **544.71 KiB gzip**，Off 基础 **114.70 KiB**，GPU 追加 **430.01 KiB**；完整版本超过旧 300 KiB 目标。原始采样已保留于 `.local/reports/terminal-v3-performance.json` |

生产视觉检查前后的 releaseId 均为 `97ff743d-24dc-44ad-8bcc-fc6068156d0d`。四阶段截图、手机截图及约 18 秒录屏 `hadesd-v3-preview.webm` 位于 `.local/reports/terminal-v3/`。WebGPU 使用 Chromium 的 SwiftShader 后端，手机检查使用视口模拟；这些结果不等于实体 GPU 帧率、手机耗电或长期热负载测试。

性能采样在同一发布版本上跳过片头后执行，仅描述稳定终端，不代表 DOS、电脑推近或元件场景的帧率。实际计时后端为 WebGL2 SwiftShader；Full / Low 闲置文字捕获均为 0，输入和翻屏各触发 1 次捕获与 1 次管线输出。包体积是实际请求的 JavaScript 响应体逐文件离线 gzip 估算，不包括 CSS、字体和图片，也不是公网下载或 Core Web Vitals 测量。

## Terminal v2 历史验收（原有结果）

- 已实现固定视口、终端分页、持续可见的命令光标、`reboot` / `display`，以及真实 Three.js / React Three Fiber / WebGPU 与 WebGL2 / TSL 文字采样、三维 CRT 和原创飞行器启动。
- `pnpm typecheck && pnpm test` **已退出 0，52 条单测通过**。
- **14 项 E2E 已全部通过（真实本地发布站，约 3.0 分钟）。** 这些计数属于 v2，不作为 v3 通过证据；完整原始说明见 [web-v2-notes.md](web-v2-notes.md)。
- 独立生产视觉检查已通过：WebGL2 1440×900 与 390×844 无文档溢出、无 pageerror；三阶段截图确认飞机由屏幕中心出现、接近镜头、越过机壳。手机输入字号 16px，文件名和分页控件可辨读。
- 已在 Codex 原生内置浏览器看到生产 WebGPU 输出，并通过截图核对文字曲面。软件渲染自动化、原生可见检查与物理 GPU 性能是不同证据；未宣称完成实体 GPU 长时性能测试。
- 性能脚本 **16/16 PASS**：v2 软件渲染采样 Full 在任意 1 秒内最多 28 帧、Low 实际约 2 帧/秒、Off 的画布/管线/RAF 均为 0；默认完整首页 JS 约 **537.72 KiB gzip**，超过旧 300 KiB 目标，这些数字为 v2 历史采样；当前性能报告以其中的版本标注为准。
- v2 视觉证据：`.local/reports/terminal-v2/craft-visual-qa.json`、`craft-crossing-bezel.png`、`craft-mobile-final.png`；动画为 `video/daemon-flight.webm`。模型、场景与 shader 自主实现，Skyworks 仅为视觉参考，未复制其资源。

## v1 历史验收（以下保留原始结果）

验收日期：2026-09-09。开发基于用户提供的 `daemon.zip` 与需求附件；用户明确要求的 Spring Boot 4.1.1、Java 25、Gradle 9.7.1 和 Reactive 架构优先于附件中冲突的版本/阻塞框架信息。

## 已交付

- 可运行的琥珀终端公开站：真实 DOM、静态文章、目录、搜索、标签、研究/项目/关于/近况/链接、阅读模式、纸张/绿色主题与 WebGL2 CRT。命令、鼠标和命令面板共用路由动作。
- 独立中文后台：登录、自动保存、不可变修订、冲突保留与手动合并、修订恢复、共享安全 Markdown 预览、图片/PDF上传与私有预览、封面、设置和发布记录。
- WebFlux + R2DBC MySQL + Reactive Redis 后端：Session/CSRF、乐观锁、ngram 搜索、私有媒体、S3 异步适配、审计与当前版本过滤。
- 可信发布 Worker：冻结快照、固定构建、产物与路径校验、CSP hash、原子 current 切换、租约/重试/崩溃对账、撤稿/回滚/过期清理。
- 本地环境初始化、CLI 管理员创建、明确标记的示例数据、Docker Compose/Nginx、环境变量说明、OpenAPI、备份恢复及故障演练脚本。

## 实际执行结果

| 命令 / 验收 | 实际结果 | 证据 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 成功；版本锁定 | `pnpm-lock.yaml` |
| `pnpm typecheck` | 退出 0；严格 TypeScript | 各前端 workspace 配置 |
| `pnpm test` | **50 通过，0 跳过**：发布器5、Markdown4、命令21、后台10、公开站10 | 源码相邻测试及发布器 test 目录 |
| `./backend/gradlew -p backend test bootJar` | **11 通过，0 跳过**；真实 MySQL/Redis/MinIO | `backend/build/reports/tests/test/index.html` |
| 真实 Worker 构建与切换 | 多次 PUBLISH/SETTINGS/WITHDRAW/ROLLBACK 成功 | 私有 `.local/published/current/manifest.json` 与后台发布记录 |
| `pnpm test:e2e` | **10 通过，0 失败/跳过/重试，40.4 秒** | `.local/reports/playwright/index.html`、`playwright.json` |
| 后台专项浏览器脚本 | 6 个常规 + 4 个冲突/恢复场景通过 | `apps/admin/artifacts/browser-report.json`、`browser-conflict-report.json` |
| `pnpm test:fault` | 停机降级与恢复通过 | `.local/reports/fault-check.json` |
| `pnpm backup && pnpm restore:drill` | 退出 0；独立数据库恢复通过 | `.local/reports/restore.json` |
| `pnpm media:cleanup` | 默认 dry-run 退出 0，未执行删除 | 后端维护 CLI |
| 独立 Docker Compose | 空站初始化、真实发布、浏览器、媒体校验及 Nginx 配置通过 | `docs/deployment-validation.md` |
| 真实浏览器性能脚本 | 8 项通过；首页 JS gzip **113.25 KiB**，Low 闲置 RAF 0 | `docs/performance.md`、`.local/reports/performance.json` |

后端集成覆盖真实事务/全文索引、CSRF/Session/权限、修订冲突、草稿隔离、指定修订发布、旧 releaseId、引用保护、上传特征/大小/路径、中文/单字/C++/IP/注入字面量搜索、过期租约、崩溃对账、版本保留和 S3 协议。

浏览器验收覆盖纯鼠标写作→上传→预览→发布→公开读取、三种入口打开相同文章、复制代码、阅读模式、未发布修订隔离、撤稿和回滚、无 JS 正文/SEO/链接、真实404、1440/1024/390/320宽度无横向溢出、WebGL禁用/实际context loss、主题恢复和键盘模态关闭。最终回归无 pageerror，没有用 hydration suppression。

实际故障演练依次停止本任务的 MySQL 和 Redis，并恢复原容器。MySQL 停机：静态文章 200 且 HTML hash 不变，搜索 503 `SERVICE_UNAVAILABLE`。Redis 停机：静态正文不变，匿名搜索 200 受限回源，已有管理员 Session 请求返回 503。恢复后内容计数不变。

最终恢复演练将备份 `2026-09-09T08-12-44.488Z` 导入独立临时数据库，恢复 **11 条内容、34 个修订、30 个发布记录**，核对 **7 个媒体文件、854 个发布文件/链接**。SQL 和文件 SHA-256、symlink 及 current manifest 验证成功；临时数据库随后删除，原数据库未覆盖。

## 视觉证据

已实际查看桌面首页、手机长文和后台预览截图，检查版面、颜色、字号、表格/代码横向滚动、长文自然增长及固定栏遮挡。截图在 `.local/reports/screenshots/`：

- `home-1440.png`、`terminal-help.png`、`search.png`
- `article-1440x900.png`、`article-1024x768.png`、`article-390x844.png`、`article-320x568.png`
- `article-no-javascript.png`、`webgl-disabled.png`、`paper-theme.png`
- `admin-publish-preview.png`、`admin-published-article.png`

后台额外截图在 `apps/admin/artifacts/`，覆盖登录、列表、编辑器、手机、冲突与设置。

## 本地交付状态与边界

主预览为 `http://127.0.0.1:18088/`，后台为 `/admin/`；管理员 `hades`，密码保存在权限 600 的 `.local/admin-password`。示例文章和项目均明确标注，后台验收草稿/审计记录保留作为证据。没有虚构作者履历或访问统计。

独立容器部署结果见 `deployment-validation.md`；实际首屏体积与 CRT 调度测量见 `performance.md`。真实浏览器报告的渲染器为 SwiftShader，不能据此保证物理 GPU 的功耗或帧率。S3 用真实 MinIO 测试，未连接真实 AWS bucket。公网域名、TLS证书、CDN和真实云部署未执行；相关步骤已写入 README。
