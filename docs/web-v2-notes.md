# 公开终端 v2：架构与验证

2026-09-09。用户最新要求为固定视口的真实终端交互，以及参考 Shader Sweden / Skyworks 的三维 CRT 和飞出屏幕的启动场景。此前可滚动工作站的完整说明原样归档于 [web-v1-notes.md](web-v1-notes.md)；其中旧布局、无启动动画、Low 默认和旧性能数字不适用于 v2。

## 固定视口与内容

- `Shell → TerminalStage → Terminal → ScreenPager` 是公开页面的统一入口。首页、目录、搜索、文章和命令输出都使用同一块屏幕，不再使用侧栏加网页滚动区域。
- `html/body` 与终端屏幕固定高度、隐藏溢出。`ScreenPager` 按可用高度和行高计算离散偏移，以 `translate3d` 翻屏；相邻屏重叠一行。滚轮不推动内容，保留 Ctrl+滚轮缩放。图片载入、字体与视口改变会重新测量。
- 鼠标点 `[ ↑ ] / [ ↓ ]` 或按 PageUp/PageDown 翻屏；未编辑输入时支持 j/k、方向键、空格、Shift+空格、Home/End。目录锚点切换到对应屏，屏外链接暂不加入 Tab 顺序，防止浏览器聚焦时偷偷滚动裁切区域。
- 底部命令区与光标始终可见。输入框用真实 selectionStart/End 定位镜像光标，中间编辑与选区在 GPU 中仍可见，IME 组合范围使用可捕获的底边线标记。Enter 执行、Shift+Enter 换行、↑↓ 历史、Ctrl+Space 补全、Ctrl+C 取消，保留 IME 合成保护。命令输出保留最近 100 条；`clear` 不清输入历史，Escape 返回当前文件。
- `reboot` 重放启动，`display` 打开显示设置；也有同名鼠标操作。公开 VFS、命令、鼠标链接和 Ctrl/Cmd+K 面板继续共用路由，终端不执行系统 Shell。
- React 19.2.8、React Router Framework 8.3.1、Vite 8.2.2、TypeScript 7.0.2 strict。冻结快照驱动静态 HTML 与 `.data`，根 loader 仅含内容元数据，单篇 loader 加载对应 Markdown。生产无需 Node SSR。
- Markdown 继续支持 GFM、表格、代码复制、受限语法着色、目录和 KaTeX；拒绝原始 HTML、危险协议及可执行 MDX。长公式按可用宽度缩小，文章通过终端分页完整浏览。无 JavaScript 与打印使用完整自然文档布局。

## 三维显示管线

固定版本为 Three.js 0.186.0、React Three Fiber 9.7.0、`@types/three` 0.185.4。`TerminalScene` 懒加载，使用 Three 的 `WebGPURenderer`：优先 WebGPU，不可用时回退 WebGL2；查询参数 `?gpu=webgl` 强制后者便于验证。

```text
真实 DOM（布局、链接、输入、选择、语义）
  → 有界 CanvasTexture（内容发生变化时重绘）
  → 终端文字 RenderTarget
  → TSL 曲面显示材质 + 三维机壳 / 灯光 / 飞行器
  → 场景 pass 的 RenderTarget
  → TSL bloom / 细粒度噪点合成
  → 浏览器画布
```

这是文字缓冲与场景缓冲构成的双 RT 主通道；bloom 还包含内部处理目标，不把“两个主通道”表述成总共只有两张 GPU 纹理。CRT 直接采样文字，包含 UV 桶形畸变、边缘色散、扫描线、荧光点阵、暗角、光标闪烁和轻微鼠标波纹；它不再只是盖在 DOM 上的透明扫描线。

`terminalTexture.ts` 按 DOM 的实际坐标绘制文字、基础盒模型、输入框、同源图片及常见 SVG 路径，处理空白折叠、字素分段、裁切和选择区域。监听内容、尺寸、主题、字体和交互变化，合并至下一帧。预算为最多 25,000 字符、4,000 元素、宽 1,600px、总像素 2,000,000，采样 DPR 不超过 1.25。

`DaemonCraft` 是代码生成的原创三角翼飞行器：硬折面金属机身、玻璃座舱、双垂尾、导航灯、双引擎和有界尾迹。启动在渲染器首次成功输出后持续约 5.6 秒；飞行器从显示平面前方接近镜头，再倾斜掠过机壳离场，最后以小尺寸停驻桌面右上角。可以跳过或重放，不依赖下载模型，也不把动画进度当成真实服务启动遥测。

参考来源是用户提供的 [shader.se](https://www.shader.se/)、[Skyworks 演示](https://skyworks-rho.vercel.app/) 与 [项目仓库](https://github.com/shader-sweden/skyworks)。模型、场景、几何和 shader 在本仓库自主实现；未复制参考项目的模型、贴图、代码资源或品牌资产。

## 显示偏好与回退

- v2 默认 Amber + Full，偏好独立保存在 `hadesd.display.v2`，不继承 v1 的 Low 默认。
- Full 使用受限连续渲染（代码上限约 30fps）；Low 在启动后改为 demand 模式，交互/内容变化触发刷新，并以约 2Hz 更新光标。Three 0.186 的内部 NodeFrame 计时器在 Low 仍按浏览器 RAF 更新；2Hz 指实际图形管线输出，不是 RAF 次数。不是旧版“Low 闲置 RAF 为 0”的模型。
- 选择 Paper 会关闭 CRT；`reader on` 关闭 GPU 环境光效，但继续保留终端和逐屏阅读。关闭模式使用真实 DOM。
- 系统减少动态效果时跳过加载飞行，场景静态按需绘制。初始化失败、超时、WebGPU device lost 或 WebGL context lost 时恢复原生 DOM 终端，公开文章不依赖 GPU 存储。
- Three 几何、材质、画布纹理、render targets、管线和 DOM 观察器在对应生命周期释放。R3F 的卸载路径不会自动销毁 WebGPURenderer，所以成功初始化的 renderer 由场景显式持有和 dispose，连同其内部 RAF 停止；尚未完成的初始化在卸载后成功也立即释放。失败初始化的 renderer 不调用会再次进入 init 的 dispose。具体调度与资源实测见 [performance.md](performance.md)，不沿用 v1 数值。

## 本轮实际验证

- `pnpm typecheck && pnpm test` 已退出 0，**52 条单测通过**；这是 v2 当前结果，替代 v1 的 50 条计数。
- 全量 **14 项 E2E 已全部通过**（真实本地发布站，约 3.0 分钟）。最终结果与具体范围以 [progress.md](progress.md) 为准。
- 独立 Chromium 生产检查 `http://127.0.0.1:18088/?gpu=webgl`：实际 WebGL2、文字纹理和 TSL 管线已输出；1440×900 与 390×844 页面无溢出，无 `pageerror`。
- 已亲眼检查启动关键帧：屏显 28% 时飞机由中央出现；64% 时机身约 262×347px，折面和双引擎清晰；76% 时机鼻 y=81 越过机壳顶沿 y=94，证实模型处于屏幕前方。最终桌面小飞机不遮挡命令区。
- 手机 390×844 文档尺寸与视口一致，输入字号为 16px，中文文件名、命令、翻屏控件可辨读。
- Codex 原生内置浏览器已刷新生产页面，实际显示 WebGPU，并通过可见截图检查文字曲面。此项可见检查与自动化软件渲染检查分开记录，不据此宣称物理 GPU 性能达标。

实际 WebGL2 输入验收通过：方向键将插入点移动到字符 10 后镜像位置正确；选中 7..12 的 alpha 可见高亮，替换与中间插入后原生输入值为 search XBeta，浏览器错误为空。证据为 `input-editing.json`、`input-middle.png` 和 `input-selection.png`。

独立 WebGPU 光标采样还刻意将 DOM 光标设为隐藏，12 帧 GPU 截图中的亮像素在约 4–115 间交替；证明闪烁来自文字纹理与 shader，见 `cursor-webgpu/result.json`。

证据目录为 `.local/reports/terminal-v2/`：`craft-visual-qa.json`、`craft-{early-emergence,near-camera,crossing-bezel,mobile-final}.png`，以及 `video/daemon-flight.webm`。关键帧中的屏显进度与异步截图返回后的 DOM 进度可能略有差异，记录已明确区分。

## 已知边界

文字纹理绘制器针对本站终端实现，不是通用网页截图引擎；任意 CSS 渐变、滤镜、伪元素、3D CSS 和复杂 SVG 不能保证一比一重现。未经 CORS 授权的远程图片不进入纹理，避免污染画布；完整原生内容可通过关闭 CRT 查看。GPU 的轻微曲面位移与原生 DOM 的平面命中区域存在小幅差异。

已完成的软件 Chromium 检查和原生 WebGPU 可见检查不等于实体手机耗电、长时间热负载或所有浏览器/GPU 组合验收。新的包体积、帧率与资源报告单独维护于 performance.md，旧版约 113 KiB 首页 JS 和 Low 0 RAF 均属于历史结果。
