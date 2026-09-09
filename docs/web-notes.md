# 公开终端 v4.1：连续投影交接、ASCII 滚屏与阶段同步

2026-09-09。v4.1 在八阶段开机流程上加入反相 ASCII 场、Skyworks 滚屏算法、连续投影交接和同步渲染时钟：DOS 先加载到 80%，镜头从同一块 CRT 拉远并展示复古电脑；用户滚动推近，穿过 ASCII 图案、弯曲屏幕与电子元件，回到 DOS 后继续加载至 100%，再穿过显示屏，分批建立固定终端。当前场景保持个人计算机主题，不使用飞机或星空。

v3 的完整架构与验收说明已逐字节归档于 [web-v3-notes.md](web-v3-notes.md)，更早版本见 [web-v2-notes.md](web-v2-notes.md) 与 [web-v1-notes.md](web-v1-notes.md)。v4.1 当前阶段同步修正版已正式发布，全仓类型检查、69 条单测、17 项生产 E2E、独立视觉 / WebGPU 与 16 项性能检查全部通过；旧版的通过数字和体积不能沿用。当前记录见 [progress.md](progress.md)，性能按 [performance.md](performance.md) 的版本标注读取。

## v4.1 ASCII 过渡与连续投影交接

本轮采用暗色 Mac Face、亮色 ASCII 背景、随滚动逐格推进的屏幕过渡，并消除相邻 tile 的非预期透底。Mac 到首格通过共享源图投影保持比例，穿屏到显示终端的阶段与进度同步交接。八阶段时间线和固定终端架构保持一致，新增回归面向几何与时序行为。

本轮屏幕变形与轮换直接适配 Filip Kantedal / Shader Development Studio 的 Skyworks [CylinderPlane](https://github.com/shader-sweden/skyworks/blob/2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb/src/components/scenes/hero/cylinder-plane.tsx) 与对应旅程逻辑，来源固定到提交 `2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb`。TSL `positionNode` 沿用平面 / 圆柱插值和圆角边界；当前实现为五列、每列 16 张屏幕，侧列使用固定种子的旋转，最后由中央列编号 12 的屏幕接回 DOS。算法明确归于 Skyworks，本站适配共享几何 / 材质及既有 DOS 时间线；电脑 / 电子元件模型和 Mac Face 画面仍由本站生成。下方“自主实现”仅描述 v4 历史，不能扩大为 v4.1 滚屏算法的原创声明。

普通屏幕和 DOS 屏幕采用不透明材质，并写入深度；圆角外部绘制黑色且同样遮挡背后物体，不把透明区域交给后方工作台。第一张屏幕也保持不透明，物理 Mac 与首格在同一渲染帧互斥显示，不用透明叠化掩盖交接。整组屏幕不再在旅程后段统一淡出，工作台光池则在进入 ASCII 时退为黑底。黑色圆角间隔是有意的屏幕边界；需要消除的是从间隔露出的工作台颜色或背面屏幕。

`screenProjection.ts` 将交接点统一为 `MAC_SCREEN_HANDOFF = 0.275`，把物理 Mac 屏幕的局部 UV 转换到与首格相同的视口 Face UV。两个材质共用 `face.sampleColor`，Mac 的局部扫描线在交接前归一，继续保留统一场景 CRT；相机、滚筒旋转与第一格曲率都从同一进度开始。这样先让投影和比例一致，再切换几何表面，避免最后一帧 Mac 与第一帧滚筒突然更换图片宽高比。两条几何回归覆盖四种宽高比、整个缩放过程中的方形源图比例，以及交接两侧任意采样点的 UV 一致性。实际画面还要在交接前后密集取样，不能只依靠整数化的 DOM 进度。

离线审片还发现阶段边界的 DOS 闪回：定时进度引用已经归零时，旧 React `phase` 可能仍为 `penetrate`，让显示屏短暂回到穿屏起点。当前修正把 Stage 的 `phaseRef` 以 `phaseState` 共享给 Scene 与 Carousel，所有渲染帧同时读取当前阶段与对应进度；React 状态继续服务于 DOM 和生命周期。新增 Stage 回归在 React 尚未提交下一阶段的窗口内调用旧渲染回调，覆盖 `resume → penetrate` 与 `penetrate → reveal`，要求其立即看到新阶段和归零进度，避免再次混用两代状态。生产 WebGPU 的实际逐帧记录已经确认穿屏进度 / 屏幕位置不回退、alpha 不回升，reveal 阶段旧 DOS / Mac / 滚筒全部隐藏；原始视频也已完成离线审查，尾段 169 帧没有蓝色 DOS 重入，直接视觉核对确认闪回消失。

Mac Face 以亮场衬托暗色机身和五官，宽屏 / 竖屏 contain 留边也保持同一亮场。字形格采用约 20 个物理像素的方格，小视口进一步缩小格子以保留至少 48 列、40 行；亮背景的字形变化固定在格子坐标，不随时间随机换字。停止滚动时屏幕空间位置保持不变，右眼眨眼与 CRT 仍可继续。这些为当前源码结构，最终画面仍须本轮实际验收。

已有 17 项 E2E 的业务和阶段断言继续有效。桌面旅程新增 27.49% → 27.51% → 27.49% → 27.51% 的真实滚轮回归：四步 DOM 百分比均为 27，逐步等待实际 GPU 进度误差小于 10⁻⁶，并验证 Mac / 首格严格互斥；保留前两帧截图，再补足累计滚轮输入继续原有旅程。中段另检查停留、反向及返回同一进度。图案明暗、逐格动作和无缝衔接由专门的实际画面检查覆盖：在电脑到 ASCII、相邻屏幕轮换和返回 DOS 的区间密集截图并录制连续滚动，分别记录 WebGL2 / WebGPU 与手机视口，保留停止和反向操作。状态字段只能证明阶段与输入响应，不能单独证明像素画面没有接缝。

当前阶段同步补丁已实际完成全仓类型检查、**69 条单测**（web 29）及 diff 检查；最终生产 E2E **17 / 17 通过，0 失败 / 跳过 / flaky，236.100 秒**，命令退出 0。修正版初次发布 `3b15df97-0392-482e-95f7-4d8b61204f17`，E2E 恢复原内容后的最终公开版本为 `65767226-6344-46a6-84d5-a4d155e270ee`，报告与阶段 journal 保留于 `.local/reports/terminal-v4-1/e2e-final/`。独立视觉、GPU 与性能结果已记录于 [progress.md](progress.md)。

独立生产 WebGPU 验证通过：完整八阶段和 reveal 0–7，错误为空，公开版本同为 `65767226-6344-46a6-84d5-a4d155e270ee`。`.local/reports/terminal-v4-1/webgpu-gpu-frames.json` 记录 142 个实际 GPU 帧，其中 12 个穿屏帧的进度 / 屏幕 z 单调前进、alpha 单调降至 0；reveal 时旧 DOS、Mac 与滚筒可见数为 0。结果见同目录 `webgpu-result.json`。手机 `handoff-mobile-webgl.json` 的 9 点取样及反向重复也通过，27.49% / 27.51% 同为 DOM 整数 27 时仍严格切换真实几何。

最终原始录屏 `.local/reports/terminal-v4-1/hadesd-v4-1-preview.webm` 已通过离线视觉审核：**28.76 秒**、1440×900、VP8 / 25fps、8,281,561 字节，未经剪辑或变速；脚本操作耗时 27.718 秒另行记录。已核对单右眼眨眼、暗色 Mac 与亮色字符场、滚筒明确的黑色分隔、硬件停驻和完整八阶段 / 七批终端显示；Mac 交接没有新增比例突变，屏幕间未露出工作台。尾段 169 帧的蓝色 DOS 重入计数为 0，并直接核对了穿屏、黑场和逐批终端画面。`production-recording.json` 为 PASS，录制前后 release 相同，pageerror / console error 均为空。

最终性能 **16 / 16 检查通过**，采样首尾公开版本一致。完整首页 JavaScript **548.25 KiB gzip**（561,404 字节），Off 基础 **115.30 KiB**，GPU 追加 **432.95 KiB**，完整版本超过旧 300 KiB 目标。稳定终端 Full **27.25 帧/秒**、任意 1 秒最多 29 帧；Low **2.00 帧/秒**、CSS 扫描动画为 none；Off 画布 / 管线帧 / RAF 均为 0。输入与翻屏各触发 1 次捕获 / 1 帧输出，Full / Low 闲置捕获均为 0；Low 仍有 Three 内部 RAF。

另在旅程 p=0.5 独立停驻 5.038 秒，93 帧约 **18.46 帧/秒**、峰值 20；实际 ASCII 网格可见，4 个硬件中心位于视锥，前后进度均为 0.5。该结果只衡量当前组合场景的停驻，不代表连续滚动或硬件独立绘制耗时。所有计时使用 WebGL2 / SwiftShader，WebGPU 验证同样为软件适配器；用户 Edge 页面保留，未声称整机隔离、实体 GPU 或手机耗电结果。CSS 合成开销未计入 Three 帧数，gzip 不含 CSS / 字体 / 图片。详见 [performance.md](performance.md) 与 `.local/reports/performance.json`。

旧诊断保留为独立证据：`pre-aspect-fix/e2e/` 为手机取样时序修正前的 16 / 17；`pre-phase-fix/e2e/` 为原 UV 版本的 17 / 17（267.498 秒），其后实际视频发现末段闪回，原片与诊断帧完整保留。当前通过数来自阶段同步修正后的新运行，下方 v4 数字、release 与录屏仍保留历史含义。

## 八阶段交互

`TerminalStage` 管理 `boot → pullback → hero → journey → resume → penetrate → reveal → terminal`。`bootProgress` 表示 DOS 的 0–100% 视觉进度，`progress` 仅表示用户控制的滚动旅程，`phaseProgress` 表示当前定时阶段的 0–100%。整段体验固定在视口内，滚动输入改变三维场景，不推动自然文档。

| 阶段 | 显示与行为 | 如何进入下一阶段 |
| --- | --- | --- |
| `boot` | 同一台电脑 CRT 的近景，蓝色 DOS 画面加载 0–80% | 从渲染器首次成功输出开始约 2.6 秒，停在 80% |
| `pullback` | 约 2.2 秒从屏幕拉远至复古电脑，DOS 保持 80%；后半段介绍文字逐渐出现 | 电脑稳定后进入介绍画面，提前滚动不推进旅程 |
| `hero` | 左侧介绍文字，右侧电脑的提示符与闪烁光标；手机为文字在上、电脑在下 | 等待滚轮、触屏、键盘或“进入终端”按钮 |
| `journey` | 推近电脑，图案转换为 ASCII；弯曲屏幕与电子元件随滚动经过，最终返回 DOS 屏幕 | 用户推进旅程至 100%；未到终点时可以停止和反向 |
| `resume` | DOS 从之前的 80% 继续到 100% | 自动约 1.3 秒；此时仍不能输入终端命令 |
| `penetrate` | 镜头穿过完成启动的显示屏，过渡至终端空间 | 自动约 1.1 秒 |
| `reveal` | 固定终端内容按七组依次出现，真实 DOM 与 GPU 纹理同步变化 | 七个 190–260ms 随机间隔，最后保留 100ms；总计约 1.43–1.92 秒 |
| `terminal` | 全部内容、命令光标和分页可用，解除隐藏输入保护 | 保持固定终端，`reboot` 重演完整流程 |

DOS 进度与日志属于视觉叙事，不是设备检测或后端启动遥测。电脑介绍画面里的提示符也是场景元素，实际命令只在最终终端执行。

滚轮与单指上划前进，反向输入后退。ArrowDown / ArrowUp 小步前后移动，PageDown / PageUp、空格 / Shift+空格大步移动，Home 返回介绍，End 将旅程目标设为终点。这些旅程操作只在 `hero` / `journey` 有效；进入 `resume` 后由定时流程完成续启、穿屏和逐批显示。停止用户输入就停在当前旅程目标，没有自动推进旅程的时钟。

“进入终端”按钮推进旅程后继续播放后续阶段。始终可达的 `SKIP INTRO ↵`（可访问名称“跳过片头，进入终端”）跳过所有剩余阶段，立即显示全部七组。焦点不在交互控件时 Enter / Escape 也可跳过；Ctrl/Cmd+K 直接进入并打开命令面板。Ctrl/Cmd+滚轮保留浏览器缩放。

## 七组真实终端显示

`revealStep` 从 0 增加至 7，通过捕获根节点 `.stage-content` 的 `data-terminal-reveal-step` 控制实际 CSS `visibility`。内容始终占据最终布局，逐组出现时不会重新排版或改变分页尺寸。首页顺序为会话状态与 ASCII 标志、身份与启动状态、文件目录、最近公开、操作提示、分页与快捷操作、最后的命令输入；非首页正文在第五组出现。

每次属性变化都会触发既有 DOM 观察器重绘文字纹理，所以隐藏组不会提前出现在 GPU 里。随机间隔仅在进入 reveal 时生成，`reboot` 重新生成，不在每次 React render 中随机改变。第七组出现后还保留短暂停顿，直到 `terminal` 才设置 `ready=true`、移除 `inert` 并派发 `hadesd:boot-ready`。桌面可自动聚焦，手机仍只在点击后聚焦。

跳过、CRT Off、减少动态效果与 GPU 失败均直接设为 terminal / revealStep 7。重启清除 DOS、当前阶段、旅程目标和所有显示组；无 JavaScript 的预渲染内容没有客户端显示门控，打印时完整显示正文。

## 原创电脑与电子元件

`RetroMac.tsx` 用代码建立复古 Mac 风格的紧凑一体机：米色机身、真实开口的屏幕边框、通风槽、软驱口、带键帽字样的键盘、鼠标与线缆。机身标记为 HADESD；没有使用 Apple 标志，也没有下载或复制参考项目的模型。屏幕在介绍阶段显示本站生成的 `hades@macintosh ~ %` 提示符，光标由 shader 闪烁；推近时切换至原创电脑笑脸的 ASCII 图案。

`HardwareParts.tsx` 包含带铝顶防爆纹、极性条与金属引脚的电容，带陶瓷本体与镀锡端子的 0805 贴片电阻，带鸥翼引脚和定位点的 QFP 微控制器，以及带焊盘、走线和过孔的小 PCB。多个元件按旅程进度从不同位置穿过镜头，退出时逐渐淡出。介绍阶段保留工作台式柔和光池与细微纹理；v4.1 进入 ASCII 后退为黑底，避免从屏幕边界露出工作台。

`introTextures.ts` 在本地 Canvas 中生成 DOS 画面和电脑提示符。`asciiFace.ts` 自绘电脑笑脸及眨眼状态，按字形实际墨迹密度构造图集，再由 TSL 将图案亮度映射为 ASCII。v4 的 `AsciiCarousel.tsx` 使用真实弯曲网格组成三列屏幕，转动与曲率跟随滚动位置，最后一张 DOS 屏幕接入续启阶段；没有下载视频或动画图片替代这些场景。

用户提供的 [shader.se](https://www.shader.se/)、[Skyworks 演示](https://skyworks-rho.vercel.app/) 与 [项目仓库](https://github.com/shader-sweden/skyworks) 是 CRT、镜头推进和三维叙事的参考。v4 的几何、贴图生成、场景与 shader 自主实现；该句保留 v4 来源记录，v4.1 滚屏算法的 Skyworks 适配来源见本页增补。当前主题按用户纠正落在个人计算机与电子硬件。

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
  → TSL 曲面材质 + 原创电脑 / ASCII 弯曲屏幕 / 电子元件 / 灯光
  → 场景 pass 的 RenderTarget
  → 全场景 TSL 曲率 / 色散 / 扫描线 / bloom / 噪点合成
  → 浏览器画布
```

文字缓冲与场景缓冲构成双 RT 主通道，bloom 还有内部处理目标，并非总共只有两张 GPU 纹理。终端 CRT 直接采样真实文字，包含 UV 曲面、边缘色散、扫描线、荧光点阵、暗角、光标闪烁和轻微鼠标波纹。DOS 画面与电脑屏幕使用各自的生成纹理和材质，统一参与三维场景。Three 的 GPU 后处理覆盖整个三维场景；共享 CSS glass 另覆盖整页 DOM、弹窗和场景，后台使用较轻的 glass。

`terminalTexture.ts` 根据 DOM 实际坐标绘制文字、基础盒模型、输入框、同源图片及常见 SVG 路径，处理字素、裁切与选择区域。内容、尺寸、主题、字体及交互变化合并至下一帧重绘。捕获预算为最多 25,000 字符、4,000 元素、宽 1,600px、总像素 2,000,000，采样 DPR 不超过 1.25。

DOM 始终保留语义与命中区域。GPU 成功后隐藏 DOM 墨迹，由纹理呈现同一内容；GPU 失败时恢复完整 DOM。冻结快照继续驱动静态 HTML 与 `.data`，根 loader 只包含内容元数据，单篇 loader 加载对应 Markdown，生产不运行 Node SSR。此轮没有改变 WebFlux、R2DBC、Reactive Redis 或发布版本的原子切换机制。

## 显示偏好、资源与回退

- 默认 Amber + Full，继续读取和保存 `hadesd.display.v2`，保留用户已经选择的主题与显示等级；v4 没有再次重置偏好。
- Full 与片头使用受限连续渲染，代码上限约 30fps。Low 在终端阶段改为 demand 模式，由内容、交互和约 2Hz 的光标更新触发输出。实际图形输出与 Three 内部 RAF 调度分别测量，不能把 demand 等同于内部 RAF 为零。
- Paper、`crt off` 与 `reader on` 使用原生固定终端与分页。减少动态效果跳过全部片头，可保留静态按需 GPU 显示。初始化失败、超时、WebGPU device lost 或 WebGL context lost 都直接进入 DOM 终端。
- 整页 CSS glass 仅在渲染器标记为 `initializing` 时暂缓显示，首帧成功后恢复，避免 Chromium 在被整页合成层遮挡的画布下请求 WebGPU adapter 时悬挂；这不改变 WebGPU device / renderer 路径。每次 Off → Full 重新启用都先重置初始化标记，并重新启用 14 秒超时保护。
- 几何、材质、Canvas 纹理、render targets、管线、观察器与 renderer 由对应生命周期释放；异步初始化和卸载交错时也清理已成功初始化的 renderer。

## v4 历史验收

v4 首次正式发布版本为 `3a27bf41-8eea-41a9-a715-505985dcc246`。全仓类型检查与 **66 条单测通过**（publisher 5、Markdown 4、terminal 21、admin 10、web 26），最终 admin build 通过。全量生产 E2E **17 / 17 通过，0 失败 / 跳过 / flaky，242.154 秒**，命令退出 0；结束时公开版本为 `e31a16a5-e9c6-4bc2-a280-ac1ebbdc0f31`。独立后端与性能检查也在该公开版本完成，不引用 v3 的计数作为新版通过证据。新增相邻测试已覆盖分段时钟、80% 暂停、介绍等待、正反向旅程、七组真实可见性与捕获更新、输入保护、跳过、重启、回退和 SSR。E2E 已更新为记录实际阶段和 DOM 可见性，保留搜索、内容路由、长文、无 JS、输入和发布业务的既有覆盖。 首轮两项测试因未适配片头的真实隐藏与 inert 状态失败，修正测试后完整重跑通过；生命周期测试现在始终恢复初始公开内容。首轮诊断保留于 `.local/reports/terminal-v4/e2e-first-run/`，该版本正式结果另存 `.local/reports/terminal-v4/e2e-final/playwright.json`。

生产 WebGPU 独立验证通过，完整 journal 记录八阶段、80% 保持、续启递增和 reveal 0–7；最终后端为 WebGPU，文字纹理、双主 RT 与 TSL 均启用，电脑、ASCII 与元件全部隐藏，错误为空。证据位于 `.local/reports/terminal-v4/webgpu-result.json` 与 `webgpu-journal.json`。WebGL2 正常输出、禁用 GPU 回退及实际 context loss 恢复由生产 E2E 验证。

桌面 1440×900、手机 390×844 与后台视觉检查通过，无页面溢出或 pageerror。原始完整录屏 `.local/reports/terminal-v4/hadesd-v4-preview.webm` 为 **44.8 秒**、1440×900、VP8 25fps，未剪辑或重定时；脚本交互耗时 43.918 秒另行记录。离线核对了 ASCII 右眼眨眼、四类硬件、DOS 80–100% 续启、穿屏与七批终端显示。手机保留完整电脑 / 键盘 / 鼠标，后台较轻的 CRT 玻璃层覆盖整页且实际点击可聚焦输入。正式报告 `.local/reports/terminal-v4/production-capture.json` 为 PASS，前后公开版本一致；另已在 Codex 原生内置浏览器直接查看生产 WebGPU 介绍画面。

性能 **16 / 16 检查通过**。完整首页 JavaScript **547.66 KiB gzip**（560,806 字节），Off 基础 **115.29 KiB**，GPU 追加 **432.37 KiB**，完整版本超过旧 300 KiB 目标。跳过片头后，稳定终端 Full 约 **22.67 帧/秒**、任意 1 秒最多 25 帧；Low 约 **2.00 帧/秒**，CSS 扫描动画为 none；Off 画布、管线帧和 RAF 均为 0，整页玻璃层隐藏。Full / Low 闲置文字捕获均为 0，输入为 1 次捕获 / 2 帧输出，翻屏为 1 次捕获 / 1 帧输出。Low 仍存在 Three 内部 RAF 回调，未宣称零调度。原始采样已另存 `.local/reports/terminal-v4-performance.json`。

计时后端为 WebGL2 / ANGLE SwiftShader，独立 WebGPU 使用 Chromium 的软件适配器。性能计时不覆盖八阶段片头，也不衡量实体 GPU、手机耗电或 CSS 合成。体积是实际请求的 JavaScript 响应体逐文件离线 gzip 估算，不包括 CSS、字体和图片，不等同于公网下载或 Core Web Vitals。

## 可观测状态与边界

可观测状态包括 `data-intro-phase`、`data-intro-progress`、`data-boot-progress`、`data-phase-progress`、`data-reveal-step`、`data-stage-ready` 与 `data-renderer`；文字捕获根还有 `data-terminal-reveal-step`。`window.__hadesdGraphics` 记录实际后端、帧数、对应阶段 / 进度与模型可见状态；v4.1 新增 `asciiTilesVisible`，区分物理 Mac 屏幕中的 ASCII 与真实滚筒网格。检查交接时读取实际浮点旅程进度与网格可见性，避免在同一个整数百分比中误认两个不同画面。**旅程进度 100 不等于终端已就绪**；必须确认 phase=terminal 且 ready=true，不能把 resume、穿屏或部分显示当作启动完成。

文字纹理绘制器面向本站终端，并非通用网页截图引擎；复杂 CSS、伪元素和 SVG 不保证逐像素复现，未经 CORS 授权的远程图片不进入纹理。曲面文字与平面 DOM 命中区域存在轻微差异。软件 Chromium 检查、原生 WebGPU 可见检查与实体 GPU、手机耗电和长期热负载验收分别记录。
