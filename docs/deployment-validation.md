# 完整 Compose 部署验证

验证日期：2026-09-09。真实运行 Docker Desktop 的 Linux ARM64 容器；没有使用模拟 API，没有修改 DNS 或公网服务。

## 结论与保留状态

完整容器部署已实际通过：MySQL/Redis 就绪 → Flyway V1–V3 → 容器内管理员 bootstrap → Redis Session/CSRF 登录 → INITIALIZE 空站 → 创建草稿 → 指定修订 PUBLISH → Worker 静态构建与原子切换 → Nginx 阅读。最后使用包含 CRT 修复的 publisher 镜像完成一次 SETTINGS 发布。

验证项目为 `hadesd-compose-qa`，临时入口为 `http://127.0.0.1:18090`。原计划 18089 被另一个本地验证进程占用，未终止该进程，改用 18090。主开发环境 `18088 / 28080 / 23306 / 26379` 及其发布目录、数据卷均未改动。

**验收结束后已仅停止五个 QA 容器，保留镜像、数据卷和全部文件。** 18090 当前不提供服务；可按下方命令恢复。最终发布 ID：`5197a6c0-6354-4810-a57f-3f738de7039b`。

私有环境文件 `.local/compose-test.env` 权限 600；独立路径为 `.local/compose-qa/published`、`.local/compose-qa/media`、`.local/compose-qa/admin-password`。沿用本地随机秘密的副本，不在报告打印密码、Cookie、CSRF 或 Worker Token。

## 实际修复

- Temurin 25 镜像已有 UID/GID 1000，删除冲突的 `groupadd`；Java 明确以 `1000:1000` 运行。Gradle 使用 BuildKit 缓存，应用使用固定 Wrapper 与依赖锁。
- Redis 的 shell 启动方式不会触发官方 entrypoint 的自动降权，显式设置 `user: redis`。
- Backend 增加无需 curl/wget 的 HTTP 健康检查；publisher 检查后端健康与发布卷写权限。Nginx/publisher 等待 backend healthy，完整 `up --wait` 成功。
- Linux 容器中 `localhost` 预览监听与 HTTP 客户端选择的 IPv4 地址不同，导致首次预渲染 `ECONNREFUSED`。Vite `preview.host=127.0.0.1` 固定回环地址后，真实空站与文章构建均成功。
- Nginx 隐藏上游重复的浏览器安全头，输出单一 `nosniff`；后台 location 补齐 Referrer-Policy 与 X-Frame-Options。
- 静态 HTML/JS/CSS/JSON/导航数据配置 gzip，启用 `Vary: Accept-Encoding`；API location 关闭 gzip。
- 完整 Compose 传递可选 S3 与 AWS 环境变量；可选 S3 overlay 仅让 backend 加入出网网络，默认 internal 隔离不变。

## 验收证据

基础 HTTP 脚本完成 27 次有断言的检查，包括匿名后台 401、CSRF/登录退出、EMPTY、空站初始化、草稿 404、发布成功、文章 200、中文搜索、C++ 标签路径、未知页面 404、历史目录/清单 404、internal API 403。随后 SETTINGS 成功，旧 releaseId 的 `/public/site` 返回 409。

Chromium 在禁用 JavaScript 的独立上下文中打开文章，核对真实正文并点击普通栏目链接；未知路径保持 HTTP 404。390px 手机视口无页面异常、无横向溢出。最终发布后再次执行，全部通过；图像已人工查看。此验证不声称真实 GPU 性能。

真实 multipart 上传 PNG 成功，公开接口在无线上引用时返回 404，后台预览返回 200。存储卷中的字节与上传文件逐字节相等，MySQL `sha256` 与相同字节的 SHA-256 一致。响应不暴露存储键。容器 entrypoint 的 `--cleanup-media` 干运行也成功，返回 0 个超过 7 天的孤立候选，未执行删除。

Nginx 实测内容协商：文章 HTML 从 10,835 字节压缩为 4,299 字节；CSS、JS 与 `.data` 响应均有 `Content-Encoding: gzip` 和 `Vary: Accept-Encoding`，解压后的文章与 identity 响应完全一致。API 未压缩，安全头没有重复值；JSON MIME 已配置压缩。`nginx -t` 返回 0。

后端新增 `/public/site?releaseId=` 回归后，11 个真实/单元测试仍全部通过，0 失败、0 跳过。

所有原始结果位于 `.local/compose-qa/`：

| 文件 | 内容 |
| --- | --- |
| `validation-result.json` | 27 次 HTTP 检查与首次发布 ID |
| `final-publication.json` | 最新镜像 SETTINGS 成功及旧版本拒绝 |
| `browser-result.json` | no-JS、普通链接、404、手机断言 |
| `nojs-browser.png` / `mobile-browser.png` | 实际 Chromium 截图 |
| `header-result.json` | gzip 字节数、Vary、安全响应头 |
| `media-result.json` | 附件与数据库校验一致性 |
| `container-status.json` | 停止前五个 healthy 服务与 UID |
| `image-digests.json` | 实际镜像标识 |
| `network-validation.json` | 默认和 S3 overlay 网络差异 |
| `stopped-status.json` | 五个 QA 容器均正常停止 |
| `bootstrap.log` / `cleanup-dry-run.log` | 受控 CLI 执行记录 |
| `backend-regression.log` | 11 个后端测试及 bootJar 成功 |

## 容器身份与隔离

停止前五个服务均为 running/healthy。`/proc/1/status` 验证 Java 和 publisher 为 UID 1000，Nginx 为 UID 101，MySQL/Redis 为 UID 999。MySQL 使用官方初始化 entrypoint，然后数据库进程降权；配置中的默认 exec 用户为空不等于 mysqld 以 root 运行。

只有 Nginx 映射 `127.0.0.1:18090`。MySQL、Redis、backend 与 publisher 没有宿主端口；声明的 3306/6379 仅是容器端口。

应用镜像的实际标识：

- backend: `sha256:1983b75bb19960057bdbb87109836e10c1c124eb1dafb985e91c38ba425143c1`
- publisher: `sha256:d2132549694c32acb97eb67906ad1e8b4de6c641d3979fecbcd0707e00988755`
- nginx: `sha256:d84af4852b039b295592f2dd0d43d7d0ae1f716347eccdf0be6b40e79e597378`

所有应用标签为 `1.0.0`，基础镜像版本和 digest 在 Dockerfile/Compose 中固定。

## 复现与恢复入口

本机已经保留该独立环境，恢复服务：

```sh
docker compose --env-file .local/compose-test.env -p hadesd-compose-qa -f infra/compose/compose.yaml up -d --wait
```

随后访问 `http://127.0.0.1:18090/posts/compose-qa` 或 `/admin/`。首次初始化已完成，不要再次 bootstrap 现有管理员。

从干净环境开始的操作在根 README 中。确保使用独立数据库卷和独立发布/媒体目录，容器 UID 1000 可读写必要挂载，密码文件可由该 UID 读取；不要设置全局 777。在本次 Docker Desktop 环境中，现有 600 密码文件与发布/媒体挂载均实测可用。

首次没有 current 时，`/public/release` 为 EMPTY，后台和健康检查正常；公开首页在第一次 INITIALIZE/SETTINGS 发布前可以是 404。不要通过创建伪造的 current 绕过 Worker。构建失败保留原有指针，修复受信任构建入口后重新提交任务。

本次使用的受控管理员与维护命令：

```sh
docker compose --env-file .local/compose-test.env -p hadesd-compose-qa -f infra/compose/compose.yaml exec -T backend java --enable-native-access=ALL-UNNAMED -jar /app/daemon-1.0.0.jar --bootstrap-admin
docker compose --env-file .local/compose-test.env -p hadesd-compose-qa -f infra/compose/compose.yaml run --rm --no-deps backend --cleanup-media
```

停止并保留 QA 数据：

```sh
docker compose --env-file .local/compose-test.env -p hadesd-compose-qa -f infra/compose/compose.yaml stop
```

如不再需要容器和网络，可执行 `down`；不加 `-v` 会保留数据库/Redis 数据卷，宿主发布/媒体目录也会保留。明确需要清除此 QA 数据时才使用 `down -v`。这些命令始终带 `-p hadesd-compose-qa`，不要替换成主开发项目。

容器名：`hadesd-compose-qa-backend-1`、`hadesd-compose-qa-publisher-1`、`hadesd-compose-qa-nginx-1`、`hadesd-compose-qa-mysql-1`、`hadesd-compose-qa-redis-1`。数据卷为 `hadesd-compose-qa_mysql-data` 和 `hadesd-compose-qa_redis-data`。

## 可选 S3 配置

默认本地存储无需云账户。外部 S3 必须组合覆盖文件，设置私有 bucket 与实际凭据/角色：

```sh
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.s3.yaml up -d --wait
```

覆盖文件要求 `S3_BUCKET`、强制 `STORAGE_MODE=s3`，仅 backend 额外加入 edge 网络用于出网，不增加任何 backend 宿主端口。基础配置传递 `S3_REGION`、`S3_ENDPOINT`、`S3_PATH_STYLE`、可选 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_SESSION_TOKEN`。默认配置和 overlay 的合并网络均已通过配置解析断言。

本次完整 Compose 验收使用本地存储；S3 协议已由后端真实 MinIO 集成测试验证，未连接真实云 bucket、未验证生产 HTTPS 或公网 DNS。
