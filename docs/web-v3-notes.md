# 公开终端 v3：个人计算机、滚动片头与固定终端

2026-09-09。用户进一步明确主题是个人计算机：DOS 蓝色 CRT 开机、介绍文字与复古 Mac 风格电脑、滚动推近屏幕并穿过字符流和电子元件，最后进入固定终端。当前场景使用原创电脑与硬件几何，不使用飞机、星空或太空场景。用户的这次纠正优先于先前的视觉解释。

此前说明完整归档于 [web-v2-notes.md](web-v2-notes.md) 与 [web-v1-notes.md](web-v1-notes.md)。历史中的飞机启动、自动进入、测试计数、包体积与性能数字都不是 v3 的验收结果。本轮最终状态见 [progress.md](progress.md)，性能以 [performance.md](performance.md) 中明确标注的版本和采样为准。

## 四阶段交互

`TerminalStage` 管理 `boot → hero → journey → terminal`，通过独立的 `bootProgress` 和旅程 `progress` 向 `TerminalScene` 传递状态。整段体验固定在视口内；片头把用户的滚动输入映射到三维镜头进度，不依赖长网页或文档滚动位置。

| 阶段 | 显示与行为 | 如何进入下一阶段 |
| --- | --- | --- |
| `boot` | 蓝色 DOS 风格 CRT，HADESD 原创条纹标志、日志与分段进度条 | 从渲染器首次成功输出开始约 3.2 秒后进入介绍画面 |
| `hero` | 左侧“从一行代码，到一个完整世界。”与硬件 / 软件介绍，右侧米色复古电脑；手机为文字在上、电脑在下 | 等待用户滚轮、上划、键盘或点击“进入终端” |
| `journey` | 镜头推近电脑屏幕，桌面逐渐转为 ASCII 字符流，电容、贴片电阻、微控制器与小 PCB 从屏幕前方经过，终端随后显现 | 用户继续推进到 100%；停下输入就停在当前进度 |
| `terminal` | 真实内容、命令光标与 CRT；正文按屏分页 | 保持终端，只有 `reboot` 才重新播放开机 |

DOS 进度条是片头时间进度。画面中的显示适配器、内存和键盘日志属于视觉叙事，不是对用户设备或后端服务的真实诊断。

滚轮与单指上划前进，反向输入后退；在抵达终端前可以返回介绍画面。ArrowDown / ArrowUp 小步前后移动，PageDown / PageUp、空格 / Shift+空格大步移动，Home 回到介绍画面，End 推进至终端。滚轮按像素、行或页归一化，触屏按位移归一化，进度平滑追随目标；没有独立自动播放的旅程计时器。

“进入终端”按钮将旅程目标设为终点，保留推近过渡。片头始终有 `SKIP INTRO ↵`，可访问名称为“跳过片头，进入终端”，直接显示终端；焦点不在交互控件时 Enter / Escape 也可跳过。Ctrl/Cmd+K 直接进入并打开命令面板。Ctrl/Cmd+滚轮保留浏览器缩放。

片头期间终端 DOM 保持布局，供文字纹理捕获，但挂载后设为 `inert`，避免隐藏输入框接收命令。终端状态提交、解除 `inert` 后才派发 `hadesd:boot-ready`；桌面可自动聚焦输入，手机只在用户点击后聚焦。`reboot` 清除旅程目标和进度，再从 DOS 开始。CRT 关闭、系统减少动态效果或 GPU 失败时直接显示可用终端。

## 原创电脑与电子元件

`RetroMac.tsx` 用代码建立复古 Mac 风格的紧凑一体机：米色机身、真实开口的屏幕边框、通风槽、软驱口、带键帽字样的键盘与线缆。机身标记为 HADESD；没有使用 Apple 标志，也没有下载或复制参考项目的模型。屏幕有本站生成的“hello, world.”桌面纹理，推近时逐步切换至字符流。

`HardwareParts.tsx` 包含带铝顶防爆纹、极性条与金属引脚的电容，带陶瓷本体与镀锡端子的 0805 贴片电阻，带鸥翼引脚和定位点的 QFP 微控制器，以及带焊盘、走线和过孔的小 PCB。多个元件按旅程进度从不同位置穿过镜头，退出时逐渐淡出。背景为工作台式柔和光池与细微纹理。

`introTextures.ts` 在本地 Canvas 中生成 DOS 开机画面、电脑桌面和 ASCII 字形图集。字符流由 TSL 采样图集，使用规则网格、有限更新频率与色散，不靠下载视频或动画图片代替三维场景。

用户提供的 [shader.se](https://www.shader.se/)、[Skyworks 演示](https://skyworks-rho.vercel.app/) 与 [项目仓库](https://github.com/shader-sweden/skyworks) 是 CRT、镜头推进和三维叙事的参考。本站几何、贴图生成、场景与 shader 自主实现；当前主题按用户纠正落在个人计算机与电子硬件。

## 固定终端与内容

- `Shell → TerminalStage → Terminal → ScreenPager` 是公开页面的统一入口。进入终端后，首页、目录、搜索、文章和命令输出都在同一块屏幕，不使用导航栏、侧栏或页面滚动区。
- `html/body` 与终端屏幕固定高度、隐藏溢出。`ScreenPager` 按可用高度和行高计算离散偏移，以 `translate3d` 翻屏；相邻屏重叠一行。终端阶段鼠标滚轮不推动正文，图片、字体与视口变化会重新测量分页。
- 点击 `[ ↑ ] / [ ↓ ]` 或按 PageUp / PageDown 翻屏；未编辑输入时支持 j/k、方向键、空格、Shift+空格、Home / End。目录锚点切换到对应屏，屏外链接暂不进入 Tab 顺序。
- 底部命令区与真实字符块光标持续可见。真实输入框的 selectionStart / End 驱动 GPU 镜像光标；中间编辑、选区高亮和 IME 组合下划线也进入纹理。Enter 执行、Shift+Enter 换行、↑↓ 历史、Ctrl+Space 补全、Ctrl+C 取消；中文输入法选词不会误执行。
- 命令输出保留最近 100 条。`clear` 不清输入历史，Escape 返回当前文件。`display` 打开显示设置；命令、鼠标链接和 Ctrl/Cmd+K 面板共用真实路由与公开 API。终端不执行系统 Shell。
- 文章继续支持安全 Markdown、GFM、表格、代码复制、目录与 KaTeX，拒绝原始 HTML、危险协议及可执行 MDX。长公式适配可用宽度，长文通过分页完整浏览。禁用 JavaScript 和打印时恢复完整自然文档布局。

## 图形与发布架构

前端版本固定为 React 19.2.8、React Router Framework 8.3.1、Vite 8.2.2、TypeScript 7.0.2 strict、Three.js 0.186.0 与 React Three Fiber 9.7.0。`TerminalScene` 懒加载，使用 Three 的 `WebGPURenderer`：优先 WebGPU，不可用时回退 WebGL2；`?gpu=webgl` 可强制后者进行验证。

```text
真实 DOM（布局、链接、输入、选择、语义）
  → 有界 CanvasTexture（内容变化时重绘）
  → 终端文字 RenderTarget
  → TSL 曲面材质 + 原创电脑 / 电子元件 / 灯光
  → 场景 pass 的 RenderTarget
  → TSL bloom / 细粒度噪点合成
  → 浏览器画布
```

文字缓冲与场景缓冲构成双 RT 主通道，bloom 还有内部处理目标，并非总共只有两张 GPU 纹理。终端 CRT 直接采样真实文字，包含 UV 曲面、边缘色散、扫描线、荧光点阵、暗角、光标闪烁和轻微鼠标波纹。DOS 画面与电脑屏幕使用各自的生成纹理和材质，统一参与三维场景。

`terminalTexture.ts` 根据 DOM 实际坐标绘制文字、基础盒模型、输入框、同源图片及常见 SVG 路径，处理字素、裁切与选择区域。内容、尺寸、主题、字体及交互变化合并至下一帧重绘。捕获预算为最多 25,000 字符、4,000 元素、宽 1,600px、总像素 2,000,000，采样 DPR 不超过 1.25。

DOM 始终保留语义与命中区域。GPU 成功后隐藏 DOM 墨迹，由纹理呈现同一内容；GPU 失败时恢复完整 DOM。冻结快照继续驱动静态 HTML 与 `.data`，根 loader 只包含内容元数据，单篇 loader 加载对应 Markdown，生产不运行 Node SSR。此轮没有改变 WebFlux、R2DBC、Reactive Redis 或发布版本的原子切换机制。

## 显示偏好、资源与回退

- 默认 Amber + Full，继续读取和保存 `hadesd.display.v2`，保留用户已经选择的主题与显示等级；v3 没有再次重置偏好。
- Full 与片头使用受限连续渲染，代码上限约 30fps。Low 在终端阶段改为 demand 模式，由内容、交互和约 2Hz 的光标更新触发输出。实际图形输出与 Three 内部 RAF 调度分别测量，不能把 demand 等同于内部 RAF 为零。
- Paper、`crt off` 与 `reader on` 使用原生固定终端与分页。减少动态效果跳过全部片头，可保留静态按需 GPU 显示。初始化失败、超时、WebGPU device lost 或 WebGL context lost 都直接进入 DOM 终端。
- 几何、材质、Canvas 纹理、render targets、管线、观察器与 renderer 由对应生命周期释放；异步初始化和卸载交错时也清理已成功初始化的 renderer。

## 验证状态与边界

v3 已完成 `pnpm typecheck && pnpm test && git diff --check`，退出 0；**60 条单测通过**（publisher 5、Markdown 4、terminal 21、admin 10、web 20）。真实本地发布站 `http://127.0.0.1:18088/` 的全量 E2E **16 / 16 通过，0 失败，约 1.9 分钟**。当前发布版本为 `97ff743d-24dc-44ad-8bcc-fc6068156d0d`。这些是本轮实际结果，未沿用 v2 的历史计数。

新增测试覆盖 DOS 完成后等待、用户输入归一化、正反向推进、停止推进、跳过、reboot、触屏、减少动态效果和 GPU 故障回退。生产 E2E 同时验证禁用 GPU 与真实 WebGL context loss 后的原生终端交互。

生产四阶段视觉检查已通过：WebGL2 1440×900 桌面与 390×844 手机没有页面溢出或 pageerror，电脑与键鼠完整；字符流阶段六个电子元件可见，最终电脑、ASCII 与硬件全部退出，终端输入和分页继续可用。录制前后发布版本一致。证据为 `.local/reports/terminal-v3/production-capture.json`、该目录的分阶段截图和约 18 秒的 `hadesd-v3-preview.webm`。

独立 WebGPU 检查也确认真实后端、文字纹理、双主 RT 与 TSL 输出：旅程约 55.6% 时 ASCII 与六个硬件可见，最终均隐藏，错误为空，见 `.local/reports/terminal-v3/webgpu-stages.json`。该检查使用 Chromium SwiftShader，不是物理 GPU 性能测试。

性能报告的 **16 / 16 检查通过**。在同一发布版本跳过片头后的稳定终端中，WebGL2 SwiftShader 记录 Full 126 帧 / 5.024 秒，平均约 **25.08 帧/秒**，任意 1 秒最多 27 帧；Low 9 帧 / 4.503 秒，约 **2 帧/秒**，同期仍有 270 次内部 RAF 回调。Off 的管线帧、RAF 与画布均为 0。Full / Low 闲置文字捕获为 0，输入和翻屏各触发 1 次捕获及 1 次输出。

首页实际请求的 JavaScript 离线 gzip 估算：完整 Full 为 **544.71 KiB**，Off 基础为 **114.70 KiB**，GPU 追加为 **430.01 KiB**。完整版本超过旧 300 KiB 目标；数字不含 CSS、字体或图片。稳定终端采样不能推定开机 / 旅程帧率、实体 GPU 功耗或真实网络性能。完整方法与结果见 [performance.md](performance.md)，所有验收证据汇总于 [progress.md](progress.md)。

可观测状态包括 `data-intro-phase`、`data-intro-progress`、`data-boot-progress`、`data-stage-ready`、`data-renderer`；`window.__hadesdGraphics` 记录实际后端、帧数、文字纹理与当前可见电脑、字符流和硬件状态。进度 100 表示已进入终端，不能把隐藏 DOM 存在或尚未完成的镜头过渡当作启动完成。

文字纹理绘制器面向本站终端，并非通用网页截图引擎；复杂 CSS、伪元素和 SVG 不保证逐像素复现，未经 CORS 授权的远程图片不进入纹理。曲面文字与平面 DOM 命中区域存在轻微差异。软件 Chromium 检查和原生 WebGPU 可见检查不能替代实体手机耗电、长期热负载或全部浏览器 / GPU 组合验收。
