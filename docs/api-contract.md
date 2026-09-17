# API 契约 v1

共享类型：packages/contracts/src/index.ts。前缀 /api/v1，UTF-8 JSON。集合 Page<T>；body 均直接类型，不另包 data。

- GET /auth/csrf → {token,headerName}; POST /auth/login 接受 application/x-www-form-urlencoded username/password（带CSRF），成功200；POST /auth/logout 成功204；GET /auth/me → UserAccount，匿名401；GET /auth/session → {user: UserAccount | null}，匿名200，不缓存。
- GET /admin/contents → Page<Content>; POST {type,...RevisionInput} → Content。
- GET /admin/contents/{id} → Content; POST /admin/contents/{id}/revisions {version,...RevisionInput} → Content，乐观锁409。
- GET /admin/contents/{id}/revisions → Page<Revision>; GET /admin/contents/{id}/revisions/{rid} → Revision。
- GET/POST /admin/media → Page<Media>/Media，POST multipart 字段 file；GET /admin/media/{id}/content 私有预览；DELETE /admin/media/{id} →204。
- GET/PUT /admin/settings → SiteSettings。`heroTitle` 为可选字符串（允许 null，最多 120 字符），用于开场标题，支持换行；省略或留空保持经典开场。其余身份字段继续保存到站点设置并随发布生效。
- POST /admin/publish-jobs PublishRequest → PublishJob; GET /admin/publish-jobs/{id} → PublishJob；GET /admin/releases → Page<Release>；POST /admin/releases/{id}/rollback-jobs → PublishJob。
- GET /public/release → ReleaseInfo; GET /public/site → SiteSettings; GET /public/contents → Page<PublicContent> 支持type,tag,page,size,releaseId；GET /public/contents/{id} → PublicContent。
- GET /public/tags → string[]; GET /public/search?q=&page=&size=&releaseId= → Page<PublicContent>; GET /public/media/{id} 在线引用才允许。
- GET /internal/snapshot/{releaseId} → ReleaseSnapshot; POST /internal/jobs/claim → PublishJob 或204；POST /internal/jobs/{id}/heartbeat {leaseToken}；POST /internal/jobs/{id}/status {leaseToken,status,error?} → PublishJob。内部鉴权 X-Worker-Token；CSRF仅此专用凭据链路豁免。
- publish请求 operation INITIALIZE 无content；PUBLISH 必须 contentId/revisionId；WITHDRAW 必须 contentId；ROLLBACK 必须 releaseId。一次仅一个活动任务409。
- 所有时间ISO UTC，ID字符串。发布目录 ${RELEASE_ROOT}/releases/{releaseId}，原子符号链接 ${RELEASE_ROOT}/current 指向 releases/{releaseId}；其 manifest.json 必须含 releaseId/createdAt。Nginx root 为 current/site；冻结快照保存在该release目录但不可从Nginx读取。

- 扩展操作 SETTINGS：冻结当前线上内容与当前后台设置（允许空站）；设置保存不直接改变在线站点。

## 读者账号、评论与文件

UserAccount = `{id,username,displayName,role:'ADMIN'|'USER'}`。BlogComment = `{id,contentId,parentId,body,author,attachments,createdAt,updatedAt}`，author 为 UserAccount，attachments 为 Media 数组。所有写请求仍需要会话 CSRF，普通用户不能访问 `/admin/**`。

- POST `/auth/register` `{username,displayName,password}` → 201 UserAccount；不自动创建登录会话，前端成功后再走登录接口。用户名 3–32 位，以小写字母或数字开头；密码至少 12 字符且最多 72 UTF-8 字节；显示名称 1–60 字符。
- PUT `/account/profile` `{displayName}` → UserAccount；POST `/account/password` `{currentPassword,newPassword}` → 204 并结束当前会话。
- GET `/public/contents/{id}/comments?page=0&size=10` → Page<BlogComment>；POST 同路径 `{body,parentId?,attachmentIds?}` → 201 BlogComment，需要登录。仅当前公开内容可读取或发表评论，正文 1–4000 字符，每条最多 4 个本人附件，回复只保留一级。
- GET `/account/comments` → Page<BlogComment>；PUT `/account/comments/{id}` `{body,attachmentIds?}` → BlogComment；DELETE 同路径 → 204，仅作者可操作。
- GET `/admin/comments?page=0&size=20&contentId?` → Page<BlogComment>；DELETE `/admin/comments/{id}` → 204，管理员可以移除任意评论。
- GET `/account/files` → Page<Media>；POST 同路径 multipart `file` → 201 Media；GET `/account/files/{id}/content` 和 DELETE `/account/files/{id}` 仅本人可访问。被评论引用的文件不能直接删除，须先移除引用。
- GET `/public/comment-files/{id}` 只在文件被可见评论引用、对应内容仍然公开时可访问；移除最后一个公开引用后恢复私有。
- 图片内联显示，`?download=true` 强制下载；PDF、ZIP 和文本始终以附件下载。支持 PNG/JPEG/WebP（10 MiB）、PDF/ZIP（25 MiB）、UTF-8 文本（2 MiB）；用户总计最多 100 个文件 / 100 MiB。ZIP 不解压到磁盘或执行，拒绝路径穿越和过度膨胀。

账号、评论与用户附件不进入冻结文章快照，始终从当前会话 API 读取；文章正文、目录与 RSS 保留静态发布流程。错误沿用 Problem Details 的 `detail/title/code`，不要把原始数据库或密码错误直接显示给用户。
