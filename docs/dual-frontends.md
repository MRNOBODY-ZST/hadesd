# 两个前端，共用一个博客后端

`SITE_ORIGIN` 对应现有终端站；可选的 `JOURNAL_SITE_ORIGIN` 对应简洁阅读站。留空时只构建终端站，原有部署行为保持不变。两个地址必须使用不同主机名，例如：

```dotenv
SITE_ORIGIN=https://hadesd.sh
JOURNAL_SITE_ORIGIN=https://itshades.dev
```

两个前端使用同一数据库、管理员、文章、修订、附件与评论。浏览器 Cookie 按域名隔离，因此在两个域名上需要分别登录；这不是跨域 SSO。两个站点均通过自己的 `/api/` 访问同一后端，不需要开放跨域 API 或共享 Cookie 域。

## 发布与回滚

后端创建发布任务时冻结一份 snapshot；发布器领取任务并读取这份快照，先构建 `@hadesd/web`，再构建 `@hadesd/journal`。两次构建分别接收自己的 `SITE_ORIGIN`，但共享 `HADESD_SNAPSHOT` 和 release ID。两站都必须包含所有公开路由，并通过 canonical、Open Graph URL、HTML 和 CSP 检查后，才生成完整 manifest 并原子切换同一个 `current` 指针。

第二次构建或任一站点校验失败时，当前两个站点都保持旧版本。每个版本的目录为：

```text
published/releases/<releaseId>/
  site/          # 终端站 HTML、RSS、sitemap
  journal/       # 阅读站 HTML、RSS、sitemap
  snapshot.json
  manifest.json
published/current -> releases/<releaseId>
published/assets/          # 终端站不可变哈希资源
published/journal-assets/  # 阅读站不可变哈希资源
```

公开路径的结构相同，例如 `/posts/<slug>`，但 canonical、RSS、sitemap 和 robots 使用各自域名。阅读站的 Vite 资源目录及 URL 必须是 `journal-assets` 与 `/journal-assets/`，以便两个站点的长缓存资源互不覆盖。

启用阅读站后应创建一次新的发布任务。后台的“回滚”会读取旧 snapshot、分配新的 release ID，并交给当前 Worker 重建；因此即使选择单站时代的内容版本，只要 `JOURNAL_SITE_ORIGIN` 仍启用，也会重新生成两个前端。不要通过手工改 `current` 指针替代后台回滚：历史单站产物本身不含 `journal/`。

## 独立 Docker 部署

在现有私密 `.env.docker` 中设置上述两个 origin，然后运行：

```sh
./scripts/deploy.sh start
```

`compose.standalone.yaml` 自动为两个明确的 `server_name` 生成配置。两站分别固定转发协议、主机名和端口；未知 Host 返回 421，不会被透传给后端。`/health` 仍可供容器健康检查使用。

使用基础 `compose.yaml` 时可额外叠加 `compose.journal.yaml`：

```sh
docker compose --env-file .env.docker \
  -f infra/compose/compose.yaml \
  -f infra/compose/compose.journal.yaml up -d --build --wait
```

基础 Compose 没有 standalone 的 UID/GID 适配；新安装优先使用 `deploy.sh`。只有实际可信的上游代理 IP/CIDR 应加入 `TRUSTED_PROXY_CIDRS`；未列入的客户端不能通过 `X-Forwarded-For` 伪造地址。对外的 HTTPS 代理必须按域名保留两个明确的 Host，并清洗客户端传入的转发头。

## 已有 WireGuard 生产部署

`compose.production.yaml` 会挂载 `NGINX_CONFIG_FILE`，覆盖镜像内生成的配置，所以仅设置 `JOURNAL_SITE_ORIGIN` 不会自动替换生产代理文件。不要直接继续使用原来的单站 `wireguard-origin.conf`。先生成并审阅新的双站配置，例如从仓库根运行：

```sh
STANDALONE_SITE_ORIGIN=https://hadesd.sh \
JOURNAL_SITE_ORIGIN=https://itshades.dev \
TRUSTED_PROXY_CIDRS=10.77.0.1 \
node scripts/nginx-config.mjs
```

生成结果是 `/tmp/default.conf`。将它安装为新的 `NGINX_CONFIG_FILE`，保留现有 WireGuard 监听地址与端口；Compose 文件依次使用 `compose.yaml`、`compose.production.yaml`、`compose.journal.yaml`，以及已有存储 overlay。双站 overlay 把 Nginx 健康检查切换为 `/health`，不会依赖一个任意 Host 访问后台。

VPS 的终端站继续使用 `infra/nginx/public-edge.conf`；阅读站使用新增的 `infra/nginx/public-edge.journal.conf`。后者需要先准备 `itshades.dev` 的 DNS 和 TLS 证书，以及原有 Cloudflare real-IP snippet。两个 edge server 使用固定 Host 转发到同一个 WireGuard 源站，不需要暴露后端数据库、Redis 或 Worker。

配置部署后仍需一次正常发布，才能生成两个前端。上线验证应分别检查两个域名的首页、文章、canonical、RSS、sitemap、附件和独立登录，并确认两个 `/release.json` 的 release ID 相同。
