# HADESD

**a personal daemon.** 一台记录研究、工程与思考的个人计算机。v9 恢复经典 Macintosh 128K 风格的立式主机，搭配分体键盘和鼠标；左侧是暖白宋体大标题「让想象，接通现实。」，滚动提示与下箭头紧随其后。手机保持标题在上、电脑在下。五秒开机依次经历黑色 CRT 预热、DOS 滚屏、显示模式切换和图形界面加载至 80%，随后镜头带着残影拉远。电脑屏幕轮播八种终端演示，地面保留柔化的实时反射。滚轮或触屏上划逐步推近屏幕，穿过保留对称 Mac 图标的 ASCII 滚筒与有深度的二进制字符流，再回到启动画面完成剩余进度；镜头继续单向穿入屏幕，七批终端内容依次显现，最后光标开始接受输入。后台是独立的中文 Markdown 写作界面。

显示层使用 **Three.js 0.186.0、React Three Fiber 9.7.0、WebGPU / WebGL2、Three Shading Language**。真实终端文字缓冲与场景 render target 组成核心双 RT 通道，处理曲面、扫描线、色散与辉光；物理电脑的全部屏幕内容共用 CRT 镜片，平面反射相机直接渲染同一场景与动态屏幕材质，不另加地面屏幕投影。暖灰、淡紫薄雾使用两个世界空间体积和三维噪声逐步采样，分别形成近地与机后雾层，在现有场景中绘制，不新增离屏通道或 Canvas。电脑和对称 Mac Face 画面由本站生成，ASCII 屏幕变形与逐格滚动继续适配 [Skyworks 的 CylinderPlane](https://github.com/shader-sweden/skyworks/blob/2eb7ad3b4b861cbfc17adebff5e9fa8c861babeb/src/components/scenes/hero/cylinder-plane.tsx)，保留算法来源。每格图标之外的背景字符由 GPU 动态更新，二进制流使用实例化绘制。GPU 后处理覆盖三维场景，整页 CSS glass 补充终端质感，后台使用较轻效果。所有 CRT 保留圆润黑色裁切，移除显式闭合浅色描边；满屏显像时，背景、地面与雾层退场，屏幕直接和黑色相接。GPU 初始化前也使用无浅色边线的原生黑色显像画面。

经典主机只绕竖轴转动，分体键盘和鼠标保留各自造型。镜头在介绍阶段由 44° 温和展开到 52°，距离同步做正切补偿；桌面和手机使用不同的相机高度与偏航，进入滚筒前回到共享交接位置。主机、键盘和鼠标对齐共同支撑平面，三个独立占地范围同时供雾气避让与接触阴影使用；模型资源由组件释放，共享屏幕材质由场景管理。公开站 139 项测试、类型检查及四项开场 E2E 已通过，经典版已发布到隔离 QA，最终静态八阶段录屏与三场景性能复测也已通过。几何参数、当前预览与验证证据见 [docs/crt-journey.md](docs/crt-journey.md)。

此仓库保留用户 `daemon.zip` 中的 **Spring Boot 4.1.1 / Java 25 / Gradle 9.7.1**，按本次要求使用 **WebFlux + R2DBC MySQL + Reactive Redis**，不使用 MVC/JPA。附件原文保存在 [docs/source-requirements.md](docs/source-requirements.md)，实际取舍见 [docs/decisions.md](docs/decisions.md)。

博客已支持读者注册登录、资料管理、Markdown 评论与回复、图片显示、个人文件上传下载，以及作者写作、修订和发布。公开站点的账号、搜索、显示设置与评论操作均在终端内完成，`open` 使用 Vim 风格的阅读/编辑缓冲区。文章及用户附件可以统一存入私有 MinIO；配置、校验迁移与备份见 [docs/minio.md](docs/minio.md)。高级 Markdown 包含代码高亮、公式、脚注、提示块、折叠内容和按需 Mermaid 图表。操作及权限说明见 [docs/blog.md](docs/blog.md)，写作语法见 [docs/markdown-guide.md](docs/markdown-guide.md)。

## 本地启动

需要 Java 25、Node.js 24.10 或兼容的新版本、pnpm 11.19.0、Docker Engine/Compose。数据库使用独立容器与持久卷。所有本地入口仅监听 loopback；不操作真实域名。

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm setup
pnpm deps:up
pnpm backend:build
pnpm bootstrap
pnpm build
```

`pnpm setup` 生成 `.env` 与 `.local/admin-password`，权限为 600，不打印或提交密码。管理员默认用户名为 `hades`，密码从该文件读取；可以在 bootstrap 前修改文件为自己的强密码（至少 14 个字符）。`pnpm bootstrap` 仅通过本机 CLI 建立初始管理员，已存在管理员时拒绝覆盖，没有匿名管理员初始化 API。公开注册只创建普通读者账户。

每个环境变量的用途及容器覆盖规则见 [docs/configuration.md](docs/configuration.md)。

分别在三个终端启动：

```sh
pnpm backend
```

```sh
pnpm publisher
```

```sh
pnpm serve
```

- 公开站点：**http://127.0.0.1:18088/**
- 管理后台：**http://127.0.0.1:18088/admin/**
- 后端：`127.0.0.1:28080`，健康检查 `/health`
- MySQL：`127.0.0.1:23306`；Redis：`127.0.0.1:26379`

首次没有 `current` 发布指针，公开接口返回 `EMPTY`。登录后台，到发布页面初始化空站点；也可以创建文章后直接发布。仅构建前端不会改变线上指针，Worker 必须运行。端口被占用时修改 `.env` 对应值，并保持 `API_ORIGIN` 与 `SERVER_PORT` 一致。

需要明确标记的演示文章与项目时，**显式运行**：

```sh
pnpm demo
```

它通过真实登录、保存与发布 API 工作；不会填入真实个人履历或访问统计。再次执行保留已存在/已上线内容。正式使用时可在后台撤下示例。

开发热更新可运行 `pnpm dev:admin`（5174）及 `pnpm dev:web`（5173）。公开开发默认空快照；如需当前版本，设置 `HADESD_SNAPSHOT` 为 `.local/published/current/snapshot.json` 的绝对路径。生产不运行 Vite 或 Node SSR；`pnpm serve` 只是本地静态服务和 API 代理。

## 开机、探索与终端操作

初次开机共五秒：350 毫秒黑色 CRT 预热、1.6 秒 DOS 日志滚屏、180 毫秒显示模式切换，再用 2.87 秒让图形界面的状态行、分段进度条和百分比从 0% 加载到 80%。随后约 1.8 秒拉远到电脑介绍画面并等待操作；屏幕从命令提示符开始，轮播其余随机排序的 Mac 图标、ANSI 色彩和五种 Python 演示。滚轮和上划以细粒度步幅控制镜头旅程，页面本身不滚动；停止输入后平滑停在当前目标，也可反向探索。旅程到终点后，同一图形界面约 1.3 秒续载至 100%，镜头再用约 1.1 秒单向穿入屏幕，不再压缩画面或插入故障闪动。随后七组终端内容以每组 70–120 毫秒的间隔显现，约 0.6–0.9 秒后完成显示并允许命令输入。片头没有直接进入或跳过按钮，Enter / Escape 不会跳过剩余阶段。

终端屏幕占视口宽度的 98%、高度的 96%，内容留有内边距与手机安全区。首页、目录、文章和命令输出都在同一块固定屏幕中，鼠标滚轮不推动正文。长内容逐屏阅读，前后屏至少保留一行重叠；表单控件较高时增加重叠，底部光标与分页操作始终可见。GPU 的 `contentRect` 取自真实 DOM 区域，显示文字与链接、选择和输入的坐标保持一致。

| 操作 | 方法 |
| --- | --- |
| 探索电脑 | 介绍画面中滚轮向下、触屏上划，分次小幅推进；反向滚动或下划可后退 |
| 键盘探索 | ArrowDown / ArrowUp 每次前进或后退 4%；PageDown / 空格 / End 每次前进 12%，PageUp / Shift+空格 / Home 每次后退 12%；Home / End 也按步幅移动 |
| 打开文件 | 点击文件名查看排版正文；`open` / `vim` / `less welcome-to-hadesd.md` 在终端内打开源码缓冲区 |
| 终端翻屏 | 命令执行后焦点回到屏幕，↑↓、PageUp / PageDown 直接翻屏；主动进入命令框后 ↑↓ 调用历史，PageUp / PageDown 仍可翻屏 |
| Vim 编辑 | `i` / `a` 进入 INSERT，Esc 返回 NORMAL；方向键 / h j k l 移动，PgUp / PgDn 翻页，`gg` / `G` 到首尾 |
| Vim 保存与退出 | `:w` 保存、`:wq` 保存退出、`:q` 退出、`:q!` 放弃修改。管理员编辑服务器最新草稿；普通读者编辑明确标注的浏览器本地副本 |
| 命令输入 | Enter 执行，Shift+Enter 换行，↑↓ 历史，Tab / Shift+Tab 补全并循环；Ctrl+Space 查看候选；Esc 后 Tab 离开命令框；中文输入法选词不会误执行 |
| 返回当前文件 | 在命令输出中按 Escape；`clear` 清空输出但保留输入历史 |
| 搜索 | 输入 `search 关键词`，点击 `[ search ]`，或按 Ctrl/Cmd+K 打开终端内的搜索程序；`:q` / Esc 返回 |
| 显示设置 | `display` 在终端内打开设置；也支持 `theme amber\|green\|paper`、`crt off\|low\|full`、`reader on\|off` |
| 账号与文件 | `login`、`register`、`profile`、`files`、`mycomments`、`logout`；密码仅在密码字段输入，程序支持 `:q` / Esc / Ctrl+C 返回 |
| 重新开机 | 输入 `reboot` 或点击 `[ reboot ]`，重置全部进度，重新经历黑色 CRT、DOS 与图形界面 0% 启动；旅程结束进入续启后，滚轮不能再退回介绍 |

默认使用完整 CRT。支持 WebGPU 时优先使用，否则自动回退 WebGL2；`?gpu=webgl` 可显式验证 WebGL2。轻微模式在终端中减少渲染频率。关闭 CRT、纸张主题或专注阅读直接使用原生终端；系统“减少动态效果”跳过全部片头。已有显示选择继续保存在当前浏览器的 `hadesd.display.v2` 中。桌面进入终端后聚焦屏幕；开始输入命令时才进入命令框。表单和 Vim 缓冲区有各自的键盘操作，手机可以使用屏内按钮。

终端保留真实 DOM 的链接、输入、选取和语义。GPU 初始化失败或运行中丢失设备时直接恢复原生终端。禁用 JavaScript 和打印时，预渲染文章恢复自然文档布局，保证全文可访问。终端不连接服务器 Shell。DOS 日志、进度条和屏幕轮播都是片头演示，不是设备或后端的真实启动诊断；其中 Python 示例可复制到具备 Python 的终端独立运行，网站本身不执行这些代码。

## 写作与发布

1. 登录后台，创建文章、项目、研究记录或页面。PAGE 的固定标识为 `about` / `now`。
2. 编辑标题、摘要、标签、语言和 Markdown。停顿 1.2 秒后自动保存，也可立即保存。每次成功保存生成不可变修订；另一标签页发生版本冲突时会暂停保存并保留本地文字。
3. 媒体页上传 PNG/JPEG/WebP（10 MiB）或 PDF（25 MiB），在编辑器中插入或设为封面。实际文件特征和像素尺寸由服务端检查。附件在引用它的版本上线前保持私有。
4. 点击发布，明确选择修订并确认。任务依次经过 `QUEUED → BUILDING → READY → DEPLOYING → SUCCEEDED`，只有成功切换的版本可公开读取。
5. 修改已上线文章只改变草稿。再次发布前，公开正文、标签和链接保持原版。
6. 撤稿生成不包含该内容的新站点版本，旧地址返回 404；公开搜索和媒体引用同时按当前版本过滤。
7. 发布记录中可回滚保留版本。回滚会创建新的发布版本，不修改历史修订。过期版本不可回滚。
8. 站点设置保存后仍是后台配置，点击“发布站点设置”才上线；空站也支持。

完整接口说明见 [docs/api-contract.md](docs/api-contract.md) 与 [OpenAPI 3.1](docs/openapi.json)。更新契约后运行 `node scripts/openapi.mjs` 重建 OpenAPI。

## 发布一致性与安全

MySQL 保存内容、不可变修订、附件元数据、审计事件与发布任务。Redis 保存 Session、限流计数与可重建缓存，不是文章数据库。非阻塞数据库及 Redis 操作使用 Reactor；Flyway 在启动阶段迁移，密码散列与文件特征检查隔离到 boundedElastic。

发布 Worker 仅执行仓库固定构建入口，从内部 API 获取冻结快照，在非公开目录生成所有 HTML、导航 `.data`、RSS 和 sitemap。校验完成后原子切换：

```text
.local/published/
  current -> releases/<releaseId>
  releases/<releaseId>/
    manifest.json       # 当前版本权威，只读提供给后端
    snapshot.json       # 私有构建快照，Nginx 不提供
    site/               # 唯一公开正文目录
  assets/               # 保留 hash 代码资源，支持旧标签页
  staging/              # 未激活的版本，不对外提供
  work/                 # 隔离构建工作目录
```

后端通过只读 manifest 判断当前版本。数据库状态不会提前让草稿公开。过期 `releaseId` 返回 `409 RELEASE_CHANGED`。构建失败保留旧站；Worker 切换后崩溃可通过 manifest 对账。任务有租约、幂等回报和重试边界。旧正文目录从不挂载为公开 URL。

管理员采用 Redis 服务端 Session，Cookie 为 HttpOnly、SameSite=Strict、路径 `/api`；HTTPS 环境设置 `SESSION_SECURE=true`。保留 CSRF 验证，登录/退出后刷新令牌，不把认证令牌放进 localStorage。Worker 使用独立 `X-Worker-Token`，公开代理拒绝整个 internal 命名空间。

终端是浏览器内的公开内容导航器，不连接 Shell。Markdown 禁止原始 HTML 和可执行 MDX，数学渲染关闭 trust。公开构建为每页的实际内联脚本生成 CSP hash；不需要 `unsafe-eval`。KaTeX 排版允许受约束输出中的 inline style。HTML/data 不使用长期缓存，hash 资源可缓存一年。

## Compose 部署

完整容器配置在 `infra/compose/compose.yaml`，数据库/Redis 没有对外端口，backend/Worker 位于 internal 网络；Nginx 默认仅映射 `127.0.0.1:18088`。所有镜像版本及基础镜像 digest 固定。请勿同时让本机 Worker 与容器 Worker 指向不同数据库却共享同一发布目录。

在**单独目录/主机**准备 `.env`，确保 `RELEASE_ROOT`、`MEDIA_ROOT` 为绝对路径并让容器 UID 1000 可写，管理员密码文件可由 backend UID 1000 读取。不要使用全局 777。

```sh
pnpm setup
docker compose --env-file .env -f infra/compose/compose.yaml build
docker compose --env-file .env -f infra/compose/compose.yaml up -d mysql redis
docker compose --env-file .env -f infra/compose/compose.yaml run --rm backend --bootstrap-admin
docker compose --env-file .env -f infra/compose/compose.yaml up -d
```

生产入口已部署为 **[https://hadesd.sh](https://hadesd.sh)**，后台为 **[https://hadesd.sh/admin/](https://hadesd.sh/admin/)**。VPS Nginx 终止 TLS，经 WireGuard 转发到内网源站 `10.77.0.2:18088`。源站使用 `/opt/hadesd/app`、`/etc/hadesd/app.env` 和 `/srv/hadesd/published`，由 `/usr/local/sbin/hadesd-compose` 包装器与 `hadesd.service` 管理；组合基础 Compose、`compose.production.yaml` 和 `compose.minio.yaml`，保持 `SESSION_SECURE=true`。附件使用私有 MinIO，原 `/srv/hadesd/media` 保留为迁移源。现有环境不要重新运行上面的初始化 bootstrap。

2026-09-10 已完成服务器构建发布，以及公开页面、注册登录、文件上传下载、评论权限、CRT 与终端交互验收；证书当时到期日为 **2026-12-08**，VPS 的 `certbot.timer` 已启用且运行，续期 dry-run 通过，并安装了成功续期后校验与 reload Nginx 的钩子。2026-09-11 已将经典 Macintosh 128K 的 v9 部署到正式站，以当前冻结快照重建，保留原有 4 条公开内容和站点设置；29 个附件已校验迁入私有 MinIO，迁移前后备份均通过。v5 至 v8 的历史隔离预览与 v9 当前状态另见 [CRT 旅程说明](docs/crt-journey.md)。完整运行路径、证书检查、当前快照发布和恢复流程见 [docs/deployment.md](docs/deployment.md)，测试记录见 [docs/progress.md](docs/progress.md)。公开内容升级仍须经过冻结快照与原子发布。

内部服务端口不绑定公网。代理/CDN 配置如引入内容缓存，发布与撤稿后必须清除 HTML、`.data`、RSS、sitemap 和媒体缓存，并确认 purge 成功后再报告撤稿完成。本次临时构建代理已移除，随后离线发布成功。

本地存储是默认实现。S3 模式设置 `STORAGE_MODE=s3`、`S3_BUCKET`、`S3_REGION`，兼容存储可另设 `S3_ENDPOINT`、`S3_PATH_STYLE=true`。凭据使用 AWS SDK 默认凭据链（如运行环境注入 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 或实例角色）；bucket 保持私有，策略仅允许目标 bucket 内所需 Get/Put/Delete/Head 对象操作。浏览器不获得凭据或存储 key。

连接外部 S3 时，完整 Compose 必须组合可选覆盖文件；它只给 backend 增加出网网络，仍不映射 backend 端口。默认本地模式继续使用 internal 网络隔离。`AWS_SESSION_TOKEN` 也可用于临时凭据。

```sh
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.s3.yaml up -d --wait
```

S3 覆盖文件要求 `S3_BUCKET`，并将存储模式设置为 s3。基础配置传递 S3 与可选 AWS 环境变量，不能只填写 `.env` 而遗漏覆盖文件。真实 Compose 本地验证及保留环境见 [docs/deployment-validation.md](docs/deployment-validation.md)。

## 备份与恢复

本地开发配置：停止写作及发布后运行 `pnpm backup`。备份包含 MySQL 一致性转储、原始媒体、保留发布目录/清单和私有配置；保存在 `.local/backups/<timestamp>`。Redis 不作为内容备份。脚本校验备份期间 current 未改变，变化则判定失败并要求重试。

执行真实恢复演练（自动使用最新备份）：

```sh
node --env-file=.env scripts/restore-drill.mjs
```

演练将 SQL 导入独立临时 MySQL 数据库，核对内容、修订、发布、账号、评论、文件及其引用表，将媒体与发布文件复制到独立目录，逐文件验证 SHA-256、symlink 目标与 current manifest；随后删除它自行创建的临时数据库，不覆盖正在运行的数据。报告位于 `.local/reports/restore.json`。

开发环境的灾难恢复：先停止 backend/Worker，保留故障现场；在全新 MySQL 实例创建目标数据库，导入 `database.sql`；将 `media/` 和 `published/` 恢复到对应持久目录（保留相对 symlink）；从安全备份恢复 `.env` 并核对权限、存储与域名；启动 backend，确认 `/public/release` 与 `current/manifest.json` 一致，再启动 Worker/Nginx。旧 Session 可以舍弃并重新登录。

已部署源站使用独立的 `infra/deploy/backup-origin.sh`，固定生产包装器和路径，手动写入 `/srv/hadesd/backups/<UTC时间戳>`；包含私有环境与管理员密码文件，成功校验后才生成 `COMPLETE`。请按 [生产备份与空数据库恢复说明](infra/deploy/README.md) 操作，不修改本地开发备份脚本来混用生产配置，也不要 bootstrap 覆盖恢复的管理员。

附件清理只处理超过 7 天、且没有任何修订或保留版本引用的对象。默认只预览：

```sh
# 使用同一套环境变量运行；--apply 才会删除符合规则的孤立附件
pnpm media:cleanup
pnpm media:cleanup --apply
```

## 验证与排查

```sh
pnpm typecheck
pnpm test
pnpm backend:test
pnpm exec playwright install chromium
pnpm test:e2e
```

E2E 需要本地 backend/Worker/static server 已启动、管理员已创建，并先运行 `pnpm demo` 建立明确标记的公开示例。发布测试会建立明确标记的验收内容，经真实静态构建执行发布/修订/撤稿/回滚，结束后恢复先前公开版本；验收草稿和审计记录保留在后台，不会假装成作者的正式内容。

`pnpm test:fault` 会依次暂时停止本地 `hadesd-local` 的 MySQL、Redis，检查静态阅读、搜索降级及后台拒绝访问，并在 finally 中恢复依赖。只在本地无写作/发布时执行，不与 E2E 同时运行。报告为 `.local/reports/fault-check.json`。

- [实施进度与最终证据](docs/progress.md)
- [后端实现说明](docs/backend-notes.md)
- [公开站 v4 实现说明](docs/web-notes.md)；[v3 历史归档](docs/web-v3-notes.md)、[v2 历史归档](docs/web-v2-notes.md)、[v1 历史归档](docs/web-v1-notes.md)
- [后台实现说明](docs/admin-notes.md)
- [独立 Docker 部署验收](docs/deployment-validation.md)
- [首屏体积与 CRT 实测](docs/performance.md)
- 后端 JUnit 报告：`backend/build/reports/tests/test/index.html`
- 浏览器报告：`.local/reports/playwright/index.html`

启动失败先检查 Java25、Docker健康状态和 `.env` 端口。401 表示需登录，403 需刷新 CSRF 或无权限，409 需处理版本/发布冲突，429 需等待限流窗口。Worker 失败日志只含脱敏摘要；可设置 `HADESD_SNAPSHOT` 为失败任务 `work/<releaseId>/snapshot.json` 的绝对路径，再运行固定 `pnpm --filter @hadesd/web build` 查看编译诊断。切换前失败不会覆盖旧 current。

本地后端启动脚本复制 JAR 至内容哈希命名的运行副本，避免边编译边运行时原 JAR 被覆写而影响延迟类加载。构建新版本后仍需重启后端。
