# Reactive 后端实施与验证

用户本次指令覆盖附件中的 MVC/JPA/Java21/Maven 信息。保留 `daemon` 原始 Spring Boot **4.1.1**、Java **25**、Gradle Wrapper **9.7.1**。应用版本为 1.0.0；不引入 MongoDB、JPA 或 Servlet MVC。

## 数据与线程边界

HTTP 由 WebFlux/Reactor Netty 处理；MySQL 操作使用 R2DBC MySQL 1.4.3 和 `DatabaseClient`，Redis 使用 Reactive Lettuce，事务由 `TransactionalOperator` 管理。运行时依赖及测试依赖锁在 `backend/gradle.lockfile`，包括 Spring Security 7.1.1、Flyway 12.4.0、Jackson 3.1.5、Testcontainers 2.0.5、AWS SDK 2.31.78。

JDBC 仅用于启动时 Flyway 迁移与显式本地维护 CLI。BCrypt 12 轮散列、媒体格式/尺寸探测和本地文件 I/O 在 `boundedElastic` 上运行；S3 使用异步客户端，首次凭据解析也在 `boundedElastic` 调用，避免阻塞 Netty 请求线程。上传聚合有严格的 25 MiB 上限，不无限制缓冲。

`V1` 创建不可变修订、内容版本、冻结快照、发布任务、全文投影、附件、管理员和审计表。`V2` 增加发布保留状态与修订媒体引用，并保守回填历史引用。`V3` 为新上传保存 SHA-256 完整性校验值；旧对象兼容保留 nullable，备份核对前不伪造校验值。已有迁移不改写。草稿保存采用版本匹配更新，冲突为 `409 REVISION_CONFLICT`；恢复修订也必须创建新修订。

## 管理员与认证

首次管理员只能通过受控本地进程创建：

```sh
java -jar backend/build/libs/daemon-1.0.0.jar --bootstrap-admin
```

先加载根目录生成的 `.env`，其中 `ADMIN_BOOTSTRAP_USERNAME` 为 3–100 个字母/数字/`_.-`；`ADMIN_BOOTSTRAP_PASSWORD_FILE` 指向权限受限的 UTF-8 密码文件。密码至少 14 个字符、最多 72 UTF-8 字节。数据库中已存在管理员时插入会失败，绝不自动覆盖。没有匿名初始化、注册或固定密码接口。

浏览器使用 Redis 服务端 Session；Cookie 名为 `HADESD_SESSION`、Path `/api`、HttpOnly、SameSite=Strict，生产启用 `SESSION_SECURE=true`。登录会轮换 Session ID，退出清除登录状态。GET `/api/v1/auth/csrf` 返回 token/headerName，登录使用表单编码并附带该 header；登录/退出后应重新获取 token。所有浏览器写操作保留 CSRF 校验。

`/api/v1/internal/**` 使用独立无 Session 的安全链，唯一凭据为至少 32 字符的 `X-Worker-Token`，使用常量时间比较。只有此链豁免 CSRF。Nginx 不应代理 internal 到公网；开发 API 默认绑定 `127.0.0.1`，容器专用网络通过 `SERVER_ADDRESS=0.0.0.0` 覆盖。

Redis 限流按实际 TCP peer 计数，不盲信客户端提供的转发地址。登录每分钟 10 次、搜索 60 次、上传 20 次；反向代理下会成为代理实例的整体上限，适合单作者第一版。Redis 故障时管理员拒绝访问；匿名搜索降级为每进程、每 peer 每分钟 20 次的有界内存限流，并回源 MySQL。当前公开快照以 releaseId 为 key 缓存 5 分钟，Redis 失败不改变公开内容边界。

## 发布、保留与查询

`current/manifest.json` 是唯一上线权威，后端只读该发布卷。没有 current 时返回 `EMPTY`，管理员和 Worker 仍可工作。`INITIALIZE` 生成空站；`SETTINGS` 冻结当前线上内容与最新后台设置，可用于空站或单独更新站点设置。

发布明确指定 contentId/revisionId。`publisher_lock` 单行事务锁保证最多一个活动任务；创建任务时冻结站点设置、内容列表、修订、路由、全文索引和媒体引用。未切换 current 的待发布快照只能从内部鉴权接口读取。公开 API 携带旧 releaseId 时返回 `409 RELEASE_CHANGED`。

Worker 领取返回 120 秒租约；应定期 heartbeat。超时重新领取会轮换 leaseToken，状态回到 BUILDING；最多领取 3 次，反复失联后标记 FAILED，管理员可重新发布。READY 前重新确认媒体对象存在；全文投影在创建冻结快照的事务内已提交。SUCCEEDED 必须验证 current 指向该 release。切换后回报前崩溃，后续领取或管理员状态读取会依据 manifest 对账。错误摘要不回显 Worker 发来的任意日志、路径或秘密。

保留当前版本和最近 5 个已完成前任；活动任务始终保留。更早版本删除正文快照、全文投影及 release 媒体引用，仅保留摘要记录并显示 EXPIRED，不能再回滚。失败构建快照 7 天后可过期。`GET /api/v1/internal/retention` 返回 `{expiredReleaseIds}`，可信 Worker 据此清理相应历史目录，并在每次删除前重新核对 current。后端不写发布卷。

MySQL 使用 `FULLTEXT ... WITH PARSER ngram`，运行时 MySQL 必须设 `--ngram-token-size=2`。两字及以上普通文本采用自然语言全文查询；单字和含标点（C++、IP、引号）的查询仅匹配当前 release 的标题/标签，避免扫描全部正文。`LIKE` 的 `%/_/!` 显式转义；所有用户值都绑定参数。空查询返回空结果，搜索词上限 200 字符，分页默认 20、最大 100。标签会去除两端空白并去重，不允许 `/`、反斜杠、`?/#/%`、控制符或仅为 `.`/`..`。PAGE slug 仅允许 `about` 和 `now`，防止系统路由冲突。

## 媒体与清理

允许实际格式为 PNG、JPEG、WebP、PDF；图片最大 10 MiB、PDF 最大 25 MiB。图片读取尺寸元数据，拒绝超过 16000 单边或 4000 万像素的对象。SVG/HTML/脚本/压缩包不接受；不能只修改扩展名或 Content-Type 绕过检测。SHA-256 和实际 MIME 同步在受限工作线程计算后保存到事实数据库，元数据 API 不暴露存储键。附件存储键由服务器生成；本地防路径穿越，S3 写入使用 `If-None-Match: *` 防止原位覆盖。

所有对象默认私有，后台预览须登录；公开附件接口必须从当前 release 引用表得到授权。PDF 以 attachment 发送，全部附件使用 nosniff。任何不可变修订或保留 release 引用的对象都不能删除，避免恢复修订后丢失附件。

本地清理默认只预览候选数：

```sh
java -jar backend/build/libs/daemon-1.0.0.jar --cleanup-media
java -jar backend/build/libs/daemon-1.0.0.jar --cleanup-media --apply
```

仅清理超过 7 天且没有任何修订和保留快照引用的对象；删除前锁定对象记录并再次核对引用。不要同时手工修改对象存储。文件系统和数据库无法组成跨系统原子事务；对象删除成功后若进程异常，可再次执行维护并核对孤立记录。

本地模式：`STORAGE_MODE=local`、`MEDIA_ROOT` 为持久目录。S3 模式：`STORAGE_MODE=s3`、`S3_BUCKET`、`S3_REGION`、可选 `S3_ENDPOINT`/`S3_PATH_STYLE`，凭据使用 AWS SDK 默认链（例如环境变量或 workload identity）。桶应保持私有，最小权限限定目标桶的 GetObject/PutObject/DeleteObject，禁止公开 ACL。没有实际云账户连接；已用真实 MinIO 验证 S3 协议。

## 实际验证

2026-09-09 执行 `./backend/gradlew -p backend test bootJar`，11 个测试、0 失败、0 跳过；独立 `bootJar` 也返回 0。真实容器：`mysql:8.4.11`、`redis:8.4.6`、`minio/minio:RELEASE.2025-05-24T17-08-30Z`，随机端口，绝不复用开发数据库。报告为 `backend/build/reports/tests/test/index.html`，JUnit XML 在 `backend/build/test-results/test/`。

验证涵盖 Session 轮换/退出/CSRF、匿名后台拒绝、乐观锁、修订不可变、草稿不公开、slug 冲突、冻结指定修订、发布/撤稿/回滚、旧 releaseId、中文/单字/C++/IP/SQL 注入字面量搜索、租约过期重新领取、旧租约拒绝、manifest 崩溃对账、真实 multipart、媒体私有到公开再撤稿、修订媒体引用保护、版本过期、Redis 故障拒绝管理员与公开回源、S3 真实写入/读取/删除及拒绝覆盖、格式/大小/路径攻击与标签校验。

故障测试刻意暂停 Redis 后，容器关闭阶段 Lettuce/Netty 可能打印连接关闭与 event-loop shutdown 日志；断言仍明确验证故障响应，不屏蔽失败、不使用 H2 或永远成功的 Mock。浏览器全流程和静态站交付由根工程测试覆盖，本后端报告不声称已验证真实云对象存储、真实域名或生产 HTTPS。

## 官方核对来源

- [Spring Boot 托管依赖](https://docs.spring.io/spring-boot/appendix/dependency-versions/coordinates.html)
- [Spring Security WebFlux CSRF](https://docs.spring.io/spring-security/reference/reactive/exploits/csrf.html)
- [R2DBC MySQL 官方项目](https://github.com/asyncer-io/r2dbc-mysql)
- [AWS S3 AsyncClient](https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/services/s3/S3AsyncClient.html)
- [Google Java Format](https://github.com/google/google-java-format)：一次性格式化工具位于忽略的 build 目录，未新增运行时依赖。
