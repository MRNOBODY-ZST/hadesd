# 五列 ASCII Mac Face → CRT 终端性能实测

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
