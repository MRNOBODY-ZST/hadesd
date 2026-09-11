# CRT 旅程性能实测

## v9 最新实测：2026-09-11，经典立式电脑与世界空间体积雾

本节对应恢复经典立式机身、分体键盘与鼠标，并完成纯黑终端背板修正后的最终静态 QA 发布。两块世界空间雾体使用三层 3D 噪声与有限步数 raymarch，保留单次真实反射；机身、键盘和鼠标分别计算接触阴影及雾避让。雾的步数为桌面 Full 16、移动 Full 10、桌面 Low 8、移动 Low 6；本次计时选择前三种场景。

测量访问 `http://127.0.0.1:18088` 的静态构建及真实 API，时间为 **2026-09-11 06:06:04–06:08:03 UTC**。采样前后 `/api/v1/public/release` 都返回 HTTP 200、ACTIVE，发布标识均为 **ea36295c-dd9d-453c-807b-f63f6aa93692**。这不是 Vite 开发站，也没有混用背板修正前的数据；[发布观察记录](../.local/reports/crt-journey-v9/release-observation.json) 单独保存了首尾响应。

使用 Windows、RTX 4090、Edge 152.0.4191.66 的 headless 模式，实际渲染后端为 **WebGPU**，申请到 **Nvidia Lovelace、非 fallback** 适配器。桌面为 1440×900 / DPR 1；移动为 390×844 的模拟视口，图形 DPR 为 1.65。Browser plugin 不可用，使用仓库 Playwright 与已安装 Edge；其他任务的测试浏览器在采样前关闭，应用源码和静态发布保持冻结。

依次运行 desktop-full、mobile-full、desktop-low，取得 **16 个约两秒的样本，33/33 项检查通过**。下表全部来自本次最终静态发布。

| 场景 | 管线提交 FPS | 绘制次数/帧 | 三角形/帧 |
| --- | ---: | ---: | ---: |
| 桌面 Full 电脑介绍 | 119.84 | 66 | 28,927 |
| 移动视口 Full 电脑介绍 | 119.90 | 66 | 28,927 |
| 桌面 Full 滚筒 50% | 119.92 | 30 | 10,499 |
| 移动视口 Full 滚筒 50% | 119.88 | 30 | 10,403 |
| 桌面 Full 终端 | 59.94 | 16 | 1,755 |
| 移动视口 Full 终端 | 59.96 | 16 | 1,755 |
| 桌面 Low 电脑介绍 | 29.97 | 66 | 28,927 |
| 桌面 Low 终端闲置 | 2.00 | 16 | 1,755 |
| 桌面 Off 终端 | 0.00 | 0 | 0 |

桌面电脑介绍的 CPU 提交耗时平均 **0.820 ms**、P95 **1.00 ms**，滚筒平均 **0.632 ms**、P95 **0.90 ms**，终端平均 **0.527 ms**、P95 **0.70 ms**。桌面介绍和滚筒的 P95 管线帧间隔均为 **8.60 ms**，终端为 **16.80 ms**。绘制与三角形计数来自每次实际管线帧的 `renderer.info`，包含当帧反射和后处理工作；三角形数量也不能表示体积雾每个像素的 raymarch 成本。

跨越真实八秒预设切换的样本记录到 preset **0→2**，保持零终端 Canvas 捕获、零 `GPUQueue.copyExternalImageToTexture` 上传。所有稳定样本的这两项计数均为零。真实 `open /about.md` 进入终端内 Vim，分页触发必要捕获并随后提交 GPU 帧，捕获 CPU 时间为 Full **0.8 ms**、Low **0.9 ms**。Low 最后提交状态是 terminal、进度为 1，闲置约 2 Hz、两秒四次 RAF；切换 Off 后 Canvas、管线帧和 RAF 均为零。采样连续性检查全部通过。

本次没有 pageerror、console error 或 HTTP 失败，也没有着色器、阴影、纹理上传告警。各上下文仅保留 Three.Clock 弃用及 Windows 忽略 `powerPreference` 的两类 warning；实际适配器仍为非回退 Nvidia WebGPU。

这些结果是短时 headless 管线提交测量：**CPU 提交时间不等于 GPU 执行时间**，没有测量显卡利用率、功耗、合成器成本、温度或整段旅程的最慢帧。headless RAF 不代表显示器实际刷新率，移动视口使用同一桌面 GPU，不代表实体手机。本轮没有重跑 WebGL、减少动态效果或 GPU 不可用场景，也不据此声称这些路径通过；没有测量下载预算、真实公网延迟或 Core Web Vitals。

[最终原始性能数据](../.local/reports/crt-journey-v9/performance.json) 包含 16 张外部截图的绝对路径。[背板修正前记录](../.local/reports/crt-journey-v9/pre-black-backing/performance.json) 已独立归档，不作为最终结论。原始脚本沿用开发站测量的通用限制文案，本轮实际来源以报告的 origin 和首尾发布观察记录为准。

PowerShell 复现（先确保该地址仍是目标静态 QA 发布）：

```powershell
$env:PERFORMANCE_BASE_URL = 'http://127.0.0.1:18088'
$env:PERFORMANCE_SCENARIOS = 'desktop-full,mobile-full,desktop-low'
$env:PERFORMANCE_SAMPLE_MS = '2000'
$env:PERFORMANCE_OUTPUT_DIR = '.local/reports/crt-journey-v9'
$env:PERFORMANCE_REPORT = '.local/reports/crt-journey-v9/performance.json'
node apps/web/scripts/measure-performance.mjs
```

以下版本保留历史记录，其模型、雾效、部署来源和性能数字均不代表 v9。

## v7 历史实测：2026-09-11，一体电脑与雾面场景

更换一体式键盘电脑后，将同材质几何合并，主机保持水平、相机提供俯视，地面按变换后的支撑高度计算。背景采用全视口云场，地面混合屏幕空间云密度与少量世界细节，反射使用更低分辨率与柔化采样。视觉和支撑规则见 [CRT 场景说明](crt-journey.md)。

同一台 RTX 4090、Edge 152.0.4191.66、真实非回退 Nvidia WebGPU 适配器，顺序运行 desktop-full、mobile-full、desktop-low，共 16 个约两秒样本，33 项检查通过。桌面 1440×900，移动视口 390×844；移动结果依然来自桌面 GPU，不代表手机硬件测量。

| 场景 | 管线提交 FPS | 绘制次数/帧 | 三角形/帧 |
| --- | ---: | ---: | ---: |
| 桌面 Full 电脑介绍 | 119.85 | 34 | 22,035 |
| 移动视口 Full 电脑介绍 | 119.89 | 34 | 22,035 |
| 桌面 Full 滚筒 | 119.91 | 26 | 10,451 |
| 移动视口 Full 滚筒 | 119.92 | 26 | 10,355 |
| 桌面 Full 终端 | 59.94 | 16 | 1,755 |
| 移动视口 Full 终端 | 59.93 | 16 | 1,755 |
| Low 终端闲置 | 2.00 | 16 | 1,755 |

相对 v6 同口径首屏的 82 次绘制、28,883 个三角形，本轮首屏绘制减少约 58.5%。桌面首屏 CPU 提交平均 0.707 ms、P95 0.90 ms；这些是 CPU 提交时间与管线帧率，不是 GPU 执行时间、显卡利用率或耗电量。

真实 preset 0→1 切换与所有稳定样本均无 Canvas 重捕获和外部纹理上传。Vim 输入／分页触发必要捕获并即时提交（Full 1.1 ms、Low 0.9 ms）。Low 片头约 30 FPS、终端闲置约 2 Hz；Off 无 Canvas、渲染帧及 RAF。所有采样连续性检查通过，无 HMR 干扰。

没有 pageerror 或着色器／阴影／纹理上传告警。原始开发站日志保留未运行鉴权 API 的 `/api/v1/auth/session` 502、Three.Clock 弃用及 Windows powerPreference 提示；真实静态预览另外验证资源与 API。Browser plugin not available，使用仓库 Playwright 与本机 Edge 串行测量。

[本轮原始数据](../.local/reports/crt-journey-v7/performance.json)。

## v6 历史实测：2026-09-11，动态 CRT 屏幕与满屏终端

v6 用共享静态图集与 GPU 采样实现 DOS 滚屏、详细 GUI 加载和八种屏幕预设；物理屏幕所有内容经过 CRT，地面由反射相机重绘同一动态材质。最终穿屏时地面随启动画面淡出。以下是最后一次源码修改后的新采样，v5 数字保留在下一节。

Edge 152.0.4191.66、RTX 4090，实际 WebGPU 适配器为 Nvidia Lovelace，非 fallback。桌面 1440×900 / DPR 1、移动视口 390×844 / DPR 受像素预算限制。依次运行 desktop-full、mobile-full、desktop-low，16 个稳定样本各约两秒，33 项检查全部通过。移动视口使用同一桌面 GPU，不代表手机硬件性能。

| 场景 | 管线提交 FPS | 绘制次数/帧 | 三角形/帧 |
| --- | ---: | ---: | ---: |
| 桌面 Full 滚筒 | 120.30 | 26 | 10,451 |
| 移动视口 Full 滚筒 | 119.84 | 26 | 10,355 |
| 桌面 Full 终端 | 59.96 | 16 | 1,755 |
| 移动视口 Full 终端 | 59.94 | 16 | 1,755 |
| Low 终端闲置 | 2.00 | 16 | 1,755 |

桌面滚筒 CPU 提交耗时平均 0.668 ms、P95 0.80 ms。FPS 指实际提交的渲染管线帧；CPU 提交时间不等于 GPU 执行时间，也没有测量显卡利用率或耗电。

所有稳定样本均无终端 Canvas 重捕获、无 `GPUQueue.copyExternalImageToTexture` 上传；跨越八秒预设切换边界的样本实际记录 preset 0→1，同样保持两项计数为零。真实 Vim 输入和分页触发一次合并捕获（Full 1.1 ms、Low 0.9 ms），随后立即提交。Low 闲置两秒约四次 RAF，Off 无 Canvas、管线帧和 RAF。

没有 pageerror 或着色器、空纹理、阴影配置警告。开发站未启动鉴权 API，因此原始日志保留每场景一次 `/api/v1/auth/session` 502，以及 Three.Clock 弃用和 Windows powerPreference 提示；最终静态预览另行检查真实 API 与资源响应。

[本轮原始性能数据](../.local/reports/crt-journey-v6/performance.json)。Browser 插件不可用，测量使用仓库 Playwright 与已安装 Edge；测试串行运行，采样期间未修改应用源码。

## v5 历史实测：2026-09-11，弯屏、反射与实例化字符

本轮增加初始弯屏 CRT、真实平面反射、薄雾、指针响应、随机字符和二进制流；移除直接跳过开场的入口。完整视觉和维护说明见 [CRT 旅程](crt-journey.md)。滚筒几何从逐格绘制改为实例化，减少工作量后提高 Full 动画的帧率上限。

使用 Edge 152.0.4191.66、1440×900 / DPR 1 和 NVIDIA RTX 4090，在同一台 Windows 机器上顺序采样。WebGL 实际为 ANGLE D3D11；WebGPU 实际申请到 NVIDIA Lovelace 的非回退适配器，powerPreference 为 high-performance。Browser 插件不可用，因此使用仓库的 Playwright 和已安装 Edge。以下为本地 Vite 场景的管线提交帧率，不能据此推导真实显示器刷新率、手机 GPU 表现或 GPU 利用率。

| 场景 | 修改前 WebGL | 本轮 WebGL | 本轮 WebGPU |
| --- | ---: | ---: | ---: |
| 电脑介绍画面，平均管线 FPS | 28.84 | 119.67 | 119.66 |
| 滚筒 50% 停驻，平均管线 FPS | 29.12 | 119.96 | 119.69 |
| 滚筒，每帧 draw calls | 167 | 26 | 26 |
| 滚筒，每帧三角形 | 405,945 | 10,451 | 10,451 |
| 滚筒，P95 帧间隔 | 35.4 ms | 8.6 ms | 8.6 ms |
| 终端闲置，平均管线 FPS | 29.12 | 59.97 | 59.96 |

同后端的滚筒 draw calls 减少 84.43%，三角形减少 97.43%。这些计数包含反射和后处理，不仅是滚筒网格。当前 WebGPU 滚筒 CPU 提交耗时平均 0.665 ms、P95 0.90 ms；这不是 GPU 执行计时。终端每帧为 20 次绘制、3,499 个三角形，增加了反射等工作，不能将所有阶段都描述成绘制量降低。

桌面与 390×844 手机视口的 WebGPU、桌面强制 WebGL、Low、减少动态效果、桌面/手机 Off 和禁用 GPU 共八个全新上下文顺序运行，每个稳定样本约四秒。47 项检查通过；阶段交接和轮滚/触屏另由四项真实浏览器开场 E2E 验证。手机视口使用同一桌面显卡，DPR 限制到 1.65，滚筒管线约 119.92 FPS；此数字不代表手机硬件测试。

所有稳定样本都没有重绘终端文字纹理。Vim 翻页触发一次合并后的文字重绘，约 1.4 ms CPU 时间。减少动态效果的稳定终端为零管线帧、零 RAF；Off 及 GPU 不可用时没有图形 canvas、管线帧或 RAF。Full 的 RAF 调度次数与提交帧率不同，浏览器合成、CSS 动画及 GPU 耗电没有测量。

矩阵还发现 Low 切换时 Fiber 时钟归零导致刷新被旧节流时间阻挡，以及 Fiber 的旧阴影默认值重复告警；修正调度与阴影配置后的 25 项复测通过。Low 最后提交阶段为 terminal、进度为 1，闲置约 2 Hz，真实 Vim 输入及分页之后立即提交更新；稳定区间不重画文字。首次矩阵的 Low 零帧记录代表已修复的问题，不能用它声称 Low 正常省电。首次纹理资源也显式初始化，短 WebGPU 冷启动确认阴影及空纹理警告消失。所有上下文均无 pageerror；本地开发 API 未启动产生的 502、Three.Clock 弃用及 Windows powerPreference 提示在原始记录中保留。

证据：[修改前基线](../.local/reports/crt-journey-v5/baseline.json)、[八场景矩阵](../.local/reports/crt-journey-v5/final-performance.json)、[Full / Low 调度复测](../.local/reports/crt-journey-v5/targeted-final-performance.json)、[WebGPU 首帧复测](../.local/reports/crt-journey-v5/first-frame-final.json)。性能脚本现在测量实际渲染和终端交互，不再测量旧版的 gzip 资源预算或后台登录成本。

PowerShell 复现（先启动开发站或使用隔离静态预览）：

```powershell
$env:PERFORMANCE_BASE_URL = 'http://127.0.0.1:18088'
$env:PERFORMANCE_OUTPUT_DIR = '.local/reports/crt-journey-v5'
$env:PERFORMANCE_BROWSER_CHANNEL = 'msedge'
node apps/web/scripts/measure-performance.mjs
```

可用 `PERFORMANCE_SCENARIOS` 选择逗号分隔的场景，`PERFORMANCE_SAMPLE_MS` 调整每个样本时长。固定测试硬件、浏览器版本与视口，并避免同时运行其他浏览器测试；热更新会使稳定计时失效。

## 历史记录：2026-09-09，v4.1

**以下保留旧版实测原文。其体积、跳过入口、时间设定、硬件模型、绘制频率和脚本方法均属于当时版本，不代表当前实现。历史命令和断言不能直接用于本轮脚本。**

当前 v4.1 默认完整体验的首页外部 JavaScript 合计 **548.25 KiB gzip**，其中独立加载的 GPU 场景为 **432.95 KiB**。**完整体验超过了原先 300 KiB 的首页预算。** 本轮包含八阶段开场、按图像亮度生成的 Mac Face ASCII、随滚动旋转的圆柱屏幕、电子元件与整系统 CRT；基础 Off 路径的体积不代表默认完整体验的成本。

2026-09-09 14:07:29.048 UTC，使用 Playwright Chromium 153.0.8010.12 访问[实际静态发布站](http://127.0.0.1:18088)。采样首尾版本均为 **65767226-6344-46a6-84d5-a4d155e270ee**，**16 项性能检查全部通过**，桌面和基础路径均无 pageerror。采样前 **69 项单元测试、17 项端到端测试全部通过**。新增 journey 停驻样本的有效性检查也通过。

原始资源清单、每帧时间点和全部断言见 [performance.json](../.local/reports/performance.json)。历史 [v4 报告](../.local/reports/terminal-v4-performance.json)、[v3 报告](../.local/reports/terminal-v3-performance.json)、[v2 报告](../.local/reports/terminal-v2-performance.json) 与 [v1 报告](../.local/reports/terminal-v1-performance.json) 单独保留；[阶段切换修复前样本](../.local/reports/terminal-v4-1/pre-phase-fix-performance.json) 也已另存，均不作为本次最终版本结论。本报告使用 Three.js 0.186.0、React Three Fiber 9.7.0 的实际管线计数。

复现：

    pnpm test:e2e
    PERFORMANCE_WEBGPU_REPORT=.local/reports/terminal-v4-1/webgpu-result.json node apps/web/scripts/measure-performance.mjs

[测量脚本](../apps/web/scripts/measure-performance.mjs) 使用全新浏览器上下文，记录浏览器实际请求的 JavaScript 响应正文，按 URL 去重，对每个正文执行 Node.js gzipSync 后求和。本地响应的 Content-Encoding 为 identity；下表表示可复现的 gzip 体积，不表示本地网络已经压缩传输。CSS、字体与图片不计入 JS；HTML 内联内容包含在单独的 HTML 行中。

**终端档位与滚动中段分别计时。** Full、Low、Off 采样在 GPU 初始化后点击“跳过片头，进入终端”，等待 terminal 阶段与加载稳定；另一个独立上下文正常走到 hero，使用真实滚轮推进到 journey 50%，停止滚动后单独采样。下载统计包含冷访问实际加载的完整 GPU 模块。其他开场阶段与运动中的滚动帧间隔没有计时。执行采样时，任务创建的 E2E、独立 WebGPU 检查与录制浏览器均已关闭；用户自己的 Edge 页面保留，其他系统负载未隔离，不能声称整机独占。

## 下载与分包

| 访问阶段 | 原始字节 | gzip 字节 | gzip KiB | 观察方式 |
| --- | ---: | ---: | ---: | --- |
| 基础终端，预先保存 CRT Off | 362,728 | 118,065 | 115.30 | 冷访问首页实际请求 9 个 JS 资源 |
| 完整模式追加 GPU 场景 | 1,639,078 | 443,339 | 432.95 | 默认 Full 冷访问减去基础资源集合，1 个动态块 |
| 默认 Full 首页全部 JS | 2,001,806 | 561,404 | 548.25 | 新访客默认体验实际请求 10 个 JS 资源 |
| 首页 HTML | 13,201 | 5,170 | 5.05 | 实际预渲染 HTML 响应 |
| 首次打开正文追加 JS | 444,506 | 134,178 | 131.03 | 通过终端 open 命令进入长文后新增的 2 个资源 |
| 后台登录页 JS | 251,372 | 78,371 | 76.53 | 独立冷访问 /admin/ 实际请求 1 个资源 |

GPU 模块在客户端初始化后动态加载，默认 Full 自动下载它；它并非只有用户主动点击后才产生的成本。提前保存 Off 偏好的桌面和手机冷访问均没有请求 GPU 场景模块。公开首页没有请求后台入口，Markdown/KaTeX 正文模块仍在打开文章时追加加载。

验收边界包括基础终端可单独启动、GPU 模块独立加载、按需更新文字纹理、限制终端绘制频率与完整销毁图形资源。旧的 300 KiB 全首页目标在本轮完整模式下未满足，不能将 115.30 KiB 的 Off 基础路径描述成默认完整体验的体积。

## 开场序列与实际渲染管线

八个阶段依次为 **boot → pullback → hero → journey → resume → penetrate → reveal → terminal**。GPU 初始化后，DOS 进度在约 2.6 秒内推进至 80%，镜头约 2.2 秒拉远，再停留在个人电脑介绍页等待滚轮、触屏、键盘或“进入终端”按钮。滚动推进圆柱屏幕与电子元件，最后一块屏幕接续 80% 的 DOS 画面；resume 将余下进度补至 100%，镜头穿入屏幕，再逐组显露七组终端内容。以上是代码中的时间设定；调度、初始化和用户停留都会影响实际总时长。

ASCII 取自原创 Mac Face 图像的亮度，暗色 Face 位于较亮的字符背景上，单眼约每 4.8 秒眨动 0.4 秒。字符图集按实际墨迹密度排序；网格约为 20 物理像素的方格，窄屏至少保留 48 列和 40 行。五个圆柱列各有 16 块曲面屏幕，中央与两侧按不同速度旋转，首尾屏幕在切平面与圆弧间变化；整组统一倾斜，屏幕与黑色圆角分隔均保持不透明并写入深度，后段不再整体淡出。图像、字符图集与 DOS 纹理由本地代码生成，源图纹理无需为每次眨眼重新绘制。曲面位置、圆角与列排布适配自 [Skyworks](https://github.com/shader-sweden/skyworks/blob/2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb/src/components/scenes/hero/cylinder-plane.tsx)，源码保留作者、commit 和来源；Face 直接共享采样节点，没有增加独立 ASCII RenderTarget。

Mac 的物理屏幕比例为 2.7 / 2.05，使用共享 UV 投影函数补偿桌面与手机视口差异。journey 27.5% 时，Mac 与首格在同一个 z=0 平面上交接，并在同一帧依据进度互斥显示；局部扫描线在交接前合入全局 CRT。渲染器同时读取共享阶段状态，防止阶段已推进但渲染仍使用上一阶段时造成 DOS 闪回。

独立的完整序列 E2E 使用真实鼠标滚轮与 Chromium 触屏输入，验证八阶段、80% 暂停、resume 续载和终端逐组显示；手机无输入时停留 hero，终端保持零文档滚动。另有生产桌面、手机、后台截图与录制核对视觉内容。[最终生产录制记录](../.local/reports/terminal-v4-1/production-recording.json) · [生产手机九点交接检查](../.local/reports/terminal-v4-1/handoff-mobile-webgl.json)

中间状态的 visibleHardwareCount 统计 visible 开启且世界坐标中心投影在相机视锥内的模型。数量随旅程位置变化，不能据此声称整个模型完整入镜或没有被遮挡；完整性另由截图核对。序列测试与录制验证功能和画面，未对开场建立帧率或耗电承诺。

终端保留真实 DOM 进行布局、输入、选择、点击与语义表达。DOM 内容按需绘制到离屏 2D canvas，作为 CanvasTexture 写入终端 RenderTarget；屏幕 TSL 材质采样真实文字纹理，施加曲率、扫描线、色散、指针波纹和光标闪烁。当前阶段的屏幕与模型进入场景 pass，再经过全画面 CRT 变形、色散、扫描线、颗粒及 Bloom 输出到最终 canvas。

共享 CSS 玻璃层补充覆盖整个公开界面和后台的扫描线、RGB 纹理与暗角。Full 的扫描带使用 14 秒周期 CSS 动画；Low 保留静态纹理并停止这条动画；Off 隐藏玻璃层。初始化 WebGPU 时玻璃层暂时隐藏，初始化完成后显示，避免本轮 Chromium 环境中观察到的适配器获取受全屏覆盖影响的问题。这个兼容处理已在独立生产 WebGPU 流程中验证。

WebGPURenderer 优先使用 WebGPU，并提供 WebGL 2 后端；两条路径使用同一 TSL 节点系统。本次计时采样通过 gpu=webgl 明确选择 WebGL 2。[Three.js WebGPURenderer](https://threejs.org/manual/en/webgpurenderer)

1440 × 900、DPR 1 下的最终绘制缓冲区为 **1440 × 900，共 1,296,000 像素**，文字纹理及终端 RenderTarget 为 **1210 × 684，共 827,640 像素**。状态中 renderTargets = 2 表示终端复制目标和完整场景 pass 两个主目标；Bloom 还使用自己的降采样与模糊目标，不能据此声称整个效果只有两个 GPU 纹理。[Three.js PassNode](https://threejs.org/docs/pages/PassNode.html) · [BloomNode](https://threejs.org/docs/pages/BloomNode.html)

实现中的分辨率与工作量边界：

- 最终 canvas 的 DPR 限制在 1 至 1.25；其像素数仍随视口大小变化。
- 文字 capture 单次最多 25,000 字符、4,000 个 DOM 元素；输出宽度不超过 1600 像素、总面积不超过 2,000,000 像素。这个 2 MP 上限只约束文字纹理，不代表全部 GPU 帧缓冲区的总预算。
- Bloom 的分辨率系数为 0.35。
- DOM 变更、输入、翻屏、字体或尺寸变化经 RAF 合并后重绘文字；闲置时不持续扫描或重画 DOM。

## 绘制频率与销毁

脚本记录 window.__hadesdGraphics.frames 的实际递增时间；该计数在 RenderPipeline.render() 完成后更新。一次管线渲染包含多个底层 GPU draw call，故下表使用“管线帧”，不将它与 WebGL drawArrays 次数或 RAF 回调混为一谈。

切换档位后等待 800 ms 再采样，设置窗口的过渡不计入闲置区间。采样使用有界时间窗口，本身不安排 RAF 或轮询计时器。

| 档位 / 场景 | 采样时长 | 管线帧 | 平均管线 FPS | 任意 1 秒最多管线帧 | RAF 回调 | 文字 capture | canvas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full 闲置 | 5.028 s | 137 | 27.25 | 29 | 274 | 0 | 1 |
| Low 闲置 | 4.503 s | 9 | 2.00 | 3 | 264 | 0 | 1 |
| 从 Low 切换 Off | 2.505 s | 0 | 0.00 | 0 | 0 | 0 | 0 |
| 手机保存 Off 后冷启动 | 1.807 s | 0 | 0.00 | 0 | 0 | 0 | 0 |

Full 的终端绘制节流上限为每秒 30 帧，本次采样没有超过上限。Low 在终端阶段使用 R3F demand 模式，每 500 ms 请求一次光标刷新；事件还可以请求额外更新。测得平均约 2 FPS，滚动一秒窗口受定时器与帧调度边界影响，最多包含 3 帧。[R3F 按需渲染](https://r3f.docs.pmnd.rs/advanced/scaling-performance)

**Low 并不等于零 RAF。** Three.js 0.186 的内部 Animation ticker 仍更新节点时间；因此 Low 的 264 个 RAF 回调与 9 次实际管线绘制同时成立。报告不将低档描述成 CPU 完全静止，也不把终端的 demand 模式推广到持续播放的开场阶段。[Three.js r186 Animation 实现](https://github.com/mrdoob/three.js/blob/r186/src/renderers/common/Animation.js)

**CSS 动画不计入管线 FPS 或 JavaScript RAF。** 本次记录的 Full 玻璃层为 display: block、扫描带动画为 system-crt-scan；Low 的扫描带动画为 none、透明度为 0.48；Off 的玻璃层为 display: none。当前脚本没有追踪浏览器绘制与合成工作，不能用管线节流上限推导整个页面的合成频率或总渲染成本。

成功初始化的 WebGPURenderer 在卸载时显式销毁。正式测量确认切换 Off 后没有残留 canvas、管线帧、RAF 回调或待执行 RAF；冷启动 Off 也不创建 GPU canvas，玻璃层隐藏。初始化失败的 renderer 使用独立失败路径，避免销毁过程中重新触发失败的初始化。

## journey 50% 停驻样本

稳定终端关闭圆柱与硬件，不能用其 FPS 描述中段场景。本次在前面的公共页面都进入 Off 后，新建一个默认 Full 上下文，正常播放到 hero，再分两次真实滚轮输入推进至 50%。等待 800 ms 使滚动缓动停止，再采样约 5 秒；这一页结束后即关闭，后台页面随后才打开。

| 场景 | 采样时长 | 管线帧 | 平均管线 FPS | 任意 1 秒最多帧 | RAF 回调 | 文字 capture |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full，journey 50% 停驻 | 5.038 s | 93 | 18.46 | 20 | 186 | 0 |

采样前后进度均精确为 0.5，阶段为 journey，asciiTilesVisible 与 hardwareVisible 为 true；四个硬件模型中心位于视锥内，Mac 隐藏，文档保持 1440 × 900、scrollY = 0。眨眼、CRT 与管线继续更新，圆柱滚动位置保持固定。原始报告的 journeyHold 保存动作前后状态、逐帧时间点与有效性检查。

五列各 16 块屏幕、每块 50 × 50 个网格，共 **400,000 个索引三角形**。这个数字来自源码拓扑，表示裁剪、背面剔除与深度拒绝之前的曲面工作量；它不是 GPU 查询结果、实际可见三角形计数或全部场景总量，硬件及后处理另有开销。共享几何和材质减少资源重复，仍保留 80 块曲面网格。

本次中段的 18.46 FPS 低于终端的 27.25 FPS，但两段渲染内容与采样时刻不同，不能把全部差值归因于三角形数量。这里没有测量持续滚动的帧间隔、整个旅程最慢位置、GPU 指令执行时间或其他开场阶段；也没有为该探索样本设置最低 FPS 达标线。

## 输入、翻屏与手机

在 Low 模式输入“cat README.md 中文”，测得 **1 次文字 capture 和 1 次新管线帧**。随后通过终端打开长文，点击“下一屏”，页码从 **1 / 3 变为 2 / 3**，触发 **1 次 capture 和 1 次管线帧**。动作观察区间内可能同时发生定时光标刷新，故管线帧数无需与文字 capture 一一对应。Full 与 Low 两段闲置采样的文字 capture 都为零。

输入和翻屏的自动化完成观察分别为约 86 ms 和 92 ms；该数值包含浏览器自动化、事件处理与采样观察开销，不作为产品输入延迟承诺。原始报告保留动作前后计数和时间点，便于复查。

长文翻屏后，document 的宽高未超过 1440 × 900 视口且 scrollY 为 0。手机 Off 测量使用 390 × 844、DPR 2 的触摸上下文，确认没有横向或纵向文档溢出、没有自动聚焦输入框，也没有 GPU canvas 或 RAF。这一段是手机 Off 路径的测量；上面的手机完整开场 E2E 是独立功能检查，两者均不代表实体手机 Full 的帧率测量。

## WebGPU 与测量范围

独立生产页面在 **同一发布版本** 实际选择了 **WebGPU 后端**，使用 Chromium 的 SwiftShader 软件适配器。最终状态记录两个主 RenderTarget、真实文字纹理、terminal 阶段和全部七组内容；ASCII、硬件和 Mac 均关闭，错误记录为空。中途约 33.13% 与 47.23% 的画面分别记录了 Face 与硬件阶段。[本轮独立 WebGPU 结果](../.local/reports/terminal-v4-1/webgpu-result.json)

[生产 WebGPU 阶段日志](../.local/reports/terminal-v4-1/webgpu-journal.json) 记录完整八阶段，确认前段进度不超过 80%、hero 停在 80%、resume 继续至 100%、reveal 包含 0 至 7。WebGPU 结果嵌入原始性能报告，但它不是上面计时样本的一部分，未沿用旧 v2、v3、v4 或阶段修复前的检查结果作为本轮结论。本次计时样本的 WebGL 2 驱动为 ANGLE / Vulkan / SwiftShader；两条 API 路径确实分别运行过，使用软件适配器不等于实体 GPU 验证。

这里的平均 FPS 只描述此次本机短时采样；任务的其他自动化浏览器已关闭，但用户浏览器与系统负载未隔离。它不推导真实手机耗电、实体 GPU 帧率、持续温度、生产网络延迟或 Core Web Vitals。16 项检查通过表示上文列出的功能与工作量边界通过，不能覆盖尚未测量的平台或将已超出的 300 KiB 总下载预算描述为达标。
