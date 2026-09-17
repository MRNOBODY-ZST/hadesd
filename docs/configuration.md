# 环境变量

`pnpm run setup` 生成本地 `.env`、存储目录和私有密码文件。重复执行不会覆盖已有配置。`.env.example` 只描述变量，不包含可用凭据；不要将 `.env`、密码文件和备份加入 Git。

| 变量 | 本地默认值 / 用途 |
| --- | --- |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `23306`；R2DBC 与启动迁移连接同一 MySQL |
| `DB_NAME` / `DB_USERNAME` | `hadesd` / `hadesd`；应用不使用 MySQL root 账号 |
| `DB_PASSWORD` | setup 随机生成的应用数据库密码 |
| `MYSQL_ROOT_PASSWORD` | setup 随机生成，仅用于 MySQL 初始化与恢复演练 |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `26379` |
| `REDIS_PASSWORD` | setup 随机生成；Session、限流与可重建缓存使用 |
| `SERVER_PORT` | `28080`，本机后端端口 |
| `API_ORIGIN` | `http://127.0.0.1:28080`；本地代理及 Worker 的后端地址 |
| `LOCAL_PORT` | `18088`，公开站和 `/admin/` 的同源入口 |
| `WORKER_TOKEN` | setup 随机生成，仅 Worker 与后端共享；浏览器不得获得 |
| `RELEASE_ROOT` | setup 生成 `.local/published` 的绝对路径；Worker 可写，后端只读 manifest |
| `MEDIA_ROOT` | setup 生成 `.local/media` 的绝对路径；保存私有原始附件 |
| `ADMIN_BOOTSTRAP_USERNAME` | `admin`，首次 CLI 初始化使用 |
| `ADMIN_BOOTSTRAP_PASSWORD_FILE` | setup 生成 `.local/admin-password` 的绝对路径；权限 600 |
| `SESSION_SECURE` | 本地 HTTP 为 `false`；HTTPS 部署设为 `true` |
| `SITE_ORIGIN` | `http://localhost:18088`，构建 canonical、Open Graph、RSS、sitemap 使用；只允许 HTTP(S) origin，不含路径、查询、fragment 或账号 |
| `WORKER_POLL_MS` | `3000`，空队列轮询间隔；租约与心跳另由协议控制 |
| `PUBLISHER_MEMORY_LIMIT` | 生产 Compose 默认 `6g`，限制整个发布容器，包括原生构建器的分配 |
| `PUBLISHER_BUILD_HEAP_MB` | 生产默认 `4096`，仅接受 256–32768 的整数 MiB；未配置的本地 Worker 沿用 Node 自动堆大小 |
| `WIREGUARD_BIND_IP` / `NGINX_CONFIG_FILE` | 生产覆盖文件必填：源站 WireGuard IPv4 与生产 Nginx 配置的主机绝对路径 |
| `STORAGE_MODE` | `local` 或 `s3` |
| `S3_BUCKET` / `S3_REGION` | 私有 bucket 名称与区域；默认区域 `us-east-1` |
| `S3_ENDPOINT` | 留空使用 AWS；兼容服务使用完整 endpoint URL |
| `S3_PATH_STYLE` | AWS 通常为 `false`；MinIO 等兼容服务可设为 `true` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | AWS SDK 默认凭据链支持的可选环境变量；使用运行环境角色时留空 |

`./scripts/deploy.sh init` 使用 Docker 内的 Node，生成独立 `.env.docker` 与 `.local/docker/`。可通过 `--site-origin`、`--admin-user`、`--port`、`--bind`、`--trusted-proxies`、`--project-name`、`--data-dir` 和 `--env-file` 配置新安装；已有配置不会被覆盖。配置路径限于根目录 `.env` / `.env.*`（不含 `.env.example`）或 `.local/` 内，数据目录限于 `.local/` 及其子目录，不接受符号链接。完整使用方法见 [自托管部署](self-hosting.md)。

| 独立安装变量 | 用途 |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | 默认 `personal-blog`，隔离容器、卷与镜像名称 |
| `APP_UID` / `APP_GID` | 初始化时的宿主用户，应用容器据此读写数据 |
| `HTTP_BIND_IP` | 默认 `127.0.0.1`；局域网可指定服务器接口地址或 `0.0.0.0` |
| `TRUSTED_PROXY_CIDRS` | 默认空；逗号分隔的 TLS 代理来源 IP/CIDR。仅这些来源的 `X-Forwarded-For` 可用于访客限流；修改后重建 Nginx，详见 [HTTPS 配置](self-hosting.md#绑定域名与-https) |
| `PUBLISHER_MEMORY_LIMIT` | 独立 Docker 安装默认 `2g`，与原生产 overlay 的 `6g` 不同 |
| `BLOG_ENV_FILE` | `deploy.sh` 使用的配置文件路径，也可用 `--env-file` 指定 |

站点名称、标语、个人简介、首页文案、开场标题、导航与外部链接在管理后台设置，保存后随发布上线。开场标题 `heroTitle` 最多 120 字符，支持换行；旧快照未填写时保留经典文案。既有数据库有成功发布但从未保存设置时，Flyway V6 从最近保留的成功快照回填身份，不覆盖已有设置。

完整 Compose 内部把数据库/Redis地址改为服务名，后端端口为 8080，Worker 的 `API_ORIGIN` 为 `http://backend:8080`；宿主机变量仍决定持久目录与对外 Nginx 端口。容器启动不会把应用数据库和 Redis 端口暴露到宿主机。

更换管理员密码必须使用受控账号管理方式；重新运行 bootstrap 不会覆盖已有账号。删除 Redis 数据会使会话失效，但不会删除文章。清空 MySQL 卷会删除内容，因此不属于常规启动或恢复排查步骤。
