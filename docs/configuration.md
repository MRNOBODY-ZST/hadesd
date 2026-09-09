# 环境变量

`pnpm setup` 生成本地 `.env`、存储目录和私有密码文件。重复执行不会覆盖已有配置。`.env.example` 只描述变量，不包含可用凭据；不要将 `.env`、密码文件和备份加入 Git。

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
| `ADMIN_BOOTSTRAP_USERNAME` | `hades`，首次 CLI 初始化使用 |
| `ADMIN_BOOTSTRAP_PASSWORD_FILE` | setup 生成 `.local/admin-password` 的绝对路径；权限 600 |
| `SESSION_SECURE` | 本地 HTTP 为 `false`；HTTPS 部署设为 `true` |
| `SITE_ORIGIN` | `https://hadesd.sh`，构建 canonical、RSS、sitemap 使用；部署者改为自己的正式域名 |
| `WORKER_POLL_MS` | `3000`，空队列轮询间隔；租约与心跳另由协议控制 |
| `PUBLISHER_MEMORY_LIMIT` | 生产 Compose 默认 `6g`，限制整个发布容器，包括原生构建器的分配 |
| `PUBLISHER_BUILD_HEAP_MB` | 生产默认 `4096`，仅接受 256–32768 的整数 MiB；未配置的本地 Worker 沿用 Node 自动堆大小 |
| `WIREGUARD_BIND_IP` / `NGINX_CONFIG_FILE` | 生产覆盖文件必填：源站 WireGuard IPv4 与生产 Nginx 配置的主机绝对路径 |
| `STORAGE_MODE` | `local` 或 `s3` |
| `S3_BUCKET` / `S3_REGION` | 私有 bucket 名称与区域；默认区域 `us-east-1` |
| `S3_ENDPOINT` | 留空使用 AWS；兼容服务使用完整 endpoint URL |
| `S3_PATH_STYLE` | AWS 通常为 `false`；MinIO 等兼容服务可设为 `true` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | AWS SDK 默认凭据链支持的可选环境变量；使用运行环境角色时留空 |

完整 Compose 内部把数据库/Redis地址改为服务名，后端端口为 8080，Worker 的 `API_ORIGIN` 为 `http://backend:8080`；宿主机变量仍决定持久目录与对外 Nginx 端口。容器启动不会把应用数据库和 Redis 端口暴露到宿主机。

更换管理员密码必须使用受控账号管理方式；重新运行 bootstrap 不会覆盖已有账号。删除 Redis 数据会使会话失效，但不会删除文章。清空 MySQL 卷会删除内容，因此不属于常规启动或恢复排查步骤。
