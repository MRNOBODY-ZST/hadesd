# 自托管部署

一套 HADESD 安装对应一个博客，拥有独立的管理员、读者、内容、媒体和发布历史。以下以 Linux + Docker Compose 为例；支持 Docker 的 NAS 也可沿用这套配置。现有 WireGuard 专用部署见 [deployment.md](deployment.md)，不要将其中的固定主机路径直接用于新安装。

## 首次安装

安装 Docker 与 Docker Compose 2.24.4 或更高版本，获取本仓库，在仓库根目录执行：

```sh
./scripts/deploy.sh init --site-origin http://localhost:18088 --admin-user admin
./scripts/deploy.sh start
./scripts/deploy.sh bootstrap
```

- `init` 在 Docker 内生成配置，不要求宿主安装 Node.js、pnpm 或 Java；已有环境文件与密码不会被覆盖。
- `start` 构建镜像，启动 MySQL、Redis、后端、发布器和 Nginx，等待健康检查；初次构建需要联网下载依赖。
- `bootstrap` 只在没有管理员的新数据库上运行。恢复或升级既有数据库不需要执行它。

默认访问地址是 `http://localhost:18088/`，后台为 `http://localhost:18088/admin/`。远程服务器上的 `localhost` 指服务器本身；可先用 SSH 端口转发访问，或按下面的局域网 / 域名方式配置。

默认文件与资源：

| 位置 | 内容 |
| --- | --- |
| `.env.docker` | 私有部署配置与随机凭据 |
| `.local/docker/admin-password` | 管理员初始密码，权限 600 |
| `.local/docker/media/` | 私有附件 |
| `.local/docker/published/` | 静态版本、快照与 current 指针 |
| Compose 项目 `personal-blog` | 容器、MySQL / Redis 数据卷与本地构建镜像 |

脚本不会把密码写到终端。读取自己的密码文件后登录后台，在「站点设置」填入名称、标语、开场标题、个人简介、首页文案与链接，然后保存。在发布页面初始化空站，或创建第一篇文章并发布，等任务成功后公开站才可访问。

后台保存设置和草稿不会立即改变公开内容。开场标题支持换行，建议两行短句；留空沿用经典开场。站点名称用于首页和终端页眉，部署域名用于终端主机名、canonical、社交分享及订阅地址。

## 局域网和 NAS

例如服务器在局域网中的地址为 `192.168.1.50`：

```sh
./scripts/deploy.sh init \
  --site-origin http://192.168.1.50:18088 \
  --bind 0.0.0.0 \
  --admin-user admin
./scripts/deploy.sh start
./scripts/deploy.sh bootstrap
```

此时访问 `http://192.168.1.50:18088/admin/`。`--bind` 决定 Docker 的监听接口，`--site-origin` 决定读者看到的公开地址；二者用途不同。默认本地目录存储即可，无需另外安装 MinIO。

初始化记录执行用户的 UID/GID，应用容器据此读写目录。使用 NAS 挂载目录时，确认该用户可以访问目录，保留密码文件的私有权限，不需要全局 `chmod 777`。

## 绑定域名与 HTTPS

在服务器的 TLS 入口配置自己的域名与证书，将请求反向代理到 `http://127.0.0.1:18088`。新安装从一开始就填写公开 HTTPS 地址：

```sh
./scripts/deploy.sh init --site-origin https://blog.example.com --admin-user admin
./scripts/deploy.sh start
./scripts/deploy.sh bootstrap
```

将示例域名换成自己的实际域名，并配置 DNS。脚本不申请证书或修改 DNS。已配置证书的宿主机 Nginx 可使用这样的代理段：

```nginx
location / {
    proxy_pass http://127.0.0.1:18088;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 26m;
}
```

这段放入现有的 HTTPS `server` 配置中；证书和监听端口由该入口管理。入口用实际连接地址覆盖 `X-Forwarded-For`，不能直接沿用访客传来的值。

为了让登录、注册和媒体限流区分访客，在 `.env.docker` 的 `TRUSTED_PROXY_CIDRS` 中填写**内层 Nginx 实际看到的 TLS 代理来源 IP**。宿主机代理经 Docker 端口进入容器时，该地址通常是 Docker 网络网关，可通过 `./scripts/deploy.sh logs nginx` 的访问日志确认；不要直接照抄 `127.0.0.1` 或其他机器的网段。例如，确认来源为 `172.22.0.1` 后设置 `TRUSTED_PROXY_CIDRS='172.22.0.1/32'`，然后执行 `./scripts/deploy.sh start` 重建。新安装也可用 `init --trusted-proxies '172.22.0.1/32'`，多个可信来源用逗号分隔。

默认名单为空，不信任任何客户端地址转发头；经过 TLS 代理的访客会暂时共用该代理的限流额度。只信任实际代理地址，不能填写 `0.0.0.0/0` 或 `::/0`。网络重建或代理迁移后应重新核对来源地址。

独立安装根据 `SITE_ORIGIN` 固定内层代理的协议与主机，并清洗其他转发头，后端只在该部署配置中启用转发头处理。外部入口应限制访问，避免内层 loopback 服务被绕过；这套通用配置不会沿用原站的 WireGuard 地址或可信代理名单。

`SITE_ORIGIN` 必须是 `http://主机[:端口]` 或 `https://主机[:端口]`，不能包含账号、子路径、查询或 fragment。当前不支持将整个站点放在 `/blog/` 这样的路径下。HTTPS 初始化会设置 `SESSION_SECURE=true`，需要从 HTTPS 地址登录。

已有安装更换域名时，编辑 `.env.docker` 的 `SITE_ORIGIN`，按协议同步 `SESSION_SECURE`，重新执行 `start` 重建代理与发布器，然后在后台发布一个新版本。既有静态正文中的 canonical 等信息需要通过重新发布更新。

## 多个独立博客

每个实例要有独立配置、数据目录、项目名和端口：

```sh
./scripts/deploy.sh --env-file .env.notes init \
  --site-origin http://localhost:18090 \
  --port 18090 \
  --project-name notes-blog \
  --data-dir .local/notes-blog \
  --admin-user alice
./scripts/deploy.sh --env-file .env.notes start
./scripts/deploy.sh --env-file .env.notes bootstrap
```

之后每次操作都使用同一个 `--env-file`，也可以设置 `BLOG_ENV_FILE`。初始化只接受仓库根目录的 `.env` / `.env.*`（不含 `.env.example`），或 `.local/` 内的配置文件；数据目录必须是 `.local/` 或其子目录。路径中不能含符号链接。这些位置同时受 Git 与 Docker 构建忽略规则保护，防止私有内容进入仓库或镜像。

Docker 内初始化将仓库挂载到相同绝对路径，生成宿主机可用的 bind mount。不要让不同数据库的发布器共用发布目录。

## 日常管理与升级

```sh
./scripts/deploy.sh status
./scripts/deploy.sh logs publisher
./scripts/deploy.sh logs backend
./scripts/deploy.sh stop
./scripts/deploy.sh start
```

`stop` 保留容器、卷和文件。升级前备份，更新仓库代码后执行 `start` 重建镜像；Flyway 会自动执行新的数据库迁移。不要重新生成凭据、删除数据库卷或再次 bootstrap。

代码升级不会自动改写当前公开静态版本。更新后在后台重新发布所需修订或站点设置，公开界面才会使用新代码。修改公开站样式但暂时不想发布最新草稿时，可单独发布站点设置。

## 备份与恢复

`pnpm backup` 针对本地源码开发的数据库，不能作为这个独立 Docker 实例的备份。下面示例适用于默认 `.env.docker` 和本地媒体目录；自定义实例需要替换相应文件与目录。备份含私有配置与密码，应保存在受保护的位置并另存到其他设备。

先等待发布任务结束，进入维护窗口，再暂停提供写入的服务。MySQL / Redis 保持运行用于导出：

```sh
blog_compose() {
  docker compose --env-file .env.docker \
    -f infra/compose/compose.yaml \
    -f infra/compose/compose.standalone.yaml "$@"
}

umask 077
backup_dir="$PWD/.local/backups/docker-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
blog_compose stop nginx publisher backend
blog_compose exec -T mysql sh -c '
  export MYSQL_PWD="$MYSQL_PASSWORD"
  exec mysqldump -u"$MYSQL_USER" --single-transaction --no-tablespaces \
    --routines --triggers "$MYSQL_DATABASE"
' > "$backup_dir/database.sql"
```

确认导出命令成功且 SQL 文件非空，再保存部署文件与本地媒体、发布目录：

```sh
tar -czf "$backup_dir/site-files.tar.gz" .env.docker .local/docker
blog_compose start backend publisher nginx
```

恢复时在独立目录或新主机操作：

1. 解压文件归档，保留发布目录中的相对符号链接。核对 `.env.docker` 中的绝对目录、用户 UID/GID、域名与端口；新主机上的路径和权限可能需要调整。
2. 使用相同 Compose 配置仅启动 MySQL / Redis，并等待健康，目标数据库必须为空。先导入 `database.sql`，不要让后端提前创建业务表，也不要 bootstrap。
3. 将附件和发布目录恢复到配置指定的位置，运行 `./scripts/deploy.sh start`。
4. 核对后台内容、公开版本、文章附件和读者文件，确认后再开放外部流量。旧会话可以舍弃并重新登录。

Redis 不是内容数据库；MySQL、媒体与发布目录需要作为同一次维护窗口的备份恢复。S3 模式还需要导出数据库引用的当前对象；不能用上述本地目录归档替代 S3 备份。迁移和 S3 导出说明见 [MinIO 与存储](minio.md)。

## 常见问题

- **全部容器健康但首页空白或 404**：先登录后台完成首次发布，静态站不是在启动容器时自动生成的。
- **初始化参数没有生效**：已有配置不会被覆盖。编辑该实例的环境文件后重建，不能用重复 `init` 重置密码或站点。
- **无法写入目录或读取密码**：核对 `APP_UID` / `APP_GID`、文件属主和 NAS 权限；目录移动后也要同步绝对路径。
- **HTTPS 登录或图片失败**：核对 TLS 入口、`SITE_ORIGIN`、`SESSION_SECURE`，并在变更后重建独立 Nginx 镜像；不要混入原有生产 overlay。
- **发布构建被系统杀死**：检查 Docker 内存/OOM 与发布器日志；`PUBLISHER_MEMORY_LIMIT` 可调整发布容器的总内存限制。
- **要使用 MinIO 或外部 S3**：按照 [存储迁移](minio.md)准备和校验附件，并在此实例所有 Compose 命令中使用同一存储 overlay。默认部署脚本管理本地存储组合，不能只改存储模式后跳过网络、桶与迁移配置。
