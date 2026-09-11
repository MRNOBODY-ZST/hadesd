# 媒体访问、盗链与 Cloudflare

## 当前行为

媒体 ID 是文章中稳定的引用，避免文章中的图片在短链接过期后失效。它不是存储桶的公开地址：MinIO 桶保持私有，服务器每次检查附件是否被当前公开版本引用。上传到后台但没有发布的附件只能通过管理员接口预览；读者个人文件也只有在仍存在公开评论引用时才允许公开读取。撤稿或删除公开评论会撤销对应的公开访问，不依赖猜不到 URL 来保护文件。

公开图片与评论附件返回 `Cross-Origin-Resource-Policy: same-origin`，阻止现代浏览器把附件嵌入其他来源的网页。服务器在读文件前检查 Fetch Metadata 与 Referer / Origin，拒绝外站子资源请求；正常本站阅读、直接打开和下载保持可用。来源按完整 scheme / host / port 比较，不能用包含域名的恶意子域名通过检查。可信反向代理负责规范化请求来源，原始转发头不是信任依据。

媒体读取按真实客户端地址合并计数，管理员文章图片和评论附件共用每分钟 240 次上限，避免更换文件 ID 绕过。Redis 暂不可用时降级为单实例每分钟 60 次的有界内存计数。原有上传限流、文件大小限制、账号权限和存储校验继续生效。限流使用 Reactive Redis，不在 WebFlux 事件线程阻塞。

这可以减少浏览器盗链和一般流量滥用，不能阻止已能阅读公开文章的人保存图片，或程序伪造来源信息。公开附件不是 DRM 保护内容。

## Cloudflare 是否会自动缓存

2026-09-12 从正式域名读取的响应含 `Server: cloudflare`、`CF-Ray` 与 `CF-Cache-Status: DYNAMIC`，表明该请求已经经过 Cloudflare。是否经过代理与是否缓存是两个问题。

Cloudflare 默认根据文件扩展名选择缓存资源，而不是根据图片 MIME；当前 `/api/v1/public/media/{id}` 没有图片扩展名。更重要的是，附件接口返回 `Cache-Control: no-store`；本轮也显式发送 `CDN-Cache-Control: no-store` 与 `Cloudflare-CDN-Cache-Control: no-store`，保留逐次权限检查及即时撤稿语义。因此现有图片不会自动进入共享 CDN 缓存。带内容哈希的公开 `/assets/` 文件沿用长期 immutable 缓存。

依据：[Cloudflare 默认缓存行为](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)、[CDN-Cache-Control](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/)。Cloudflare 的常规 Hotlink Protection 仅覆盖列出的图片扩展名，不能仅开启该开关就假定无扩展名的 API 图片受到保护，见 [官方防盗链说明](https://developers.cloudflare.com/waf/tools/scrape-shield/hotlink-protection/)。

## 若后续启用公开图片缓存

仅允许当前公开文章中引用的图片进入独立缓存路径；`/admin/`、`/api/v1/admin/`、`/api/v1/account/`、认证接口、私有媒体以及公开评论附件继续绕过缓存。不能对整个 `/api/` 设置 Cache Everything，也不能用忽略源站头的 Edge TTL 覆盖私人响应。

正式开启前，需要选择边缘失效语义：短 TTL 会使撤稿后图片最多仍可访问一个 TTL；即时撤销则需要在撤稿、回滚、引用变更后完成 Cloudflare purge，并处理 purge 失败。页面与 GPU 渲染保持 `no-transform`，避免 CDN 注入脚本影响 CSP。完成这些流程后再配置精确路径规则，并用 `CF-Cache-Status: MISS → HIT` 和撤稿后的真实响应验证。未经这一验证，不把“接入 Cloudflare”描述为“图片缓存已启用”。
