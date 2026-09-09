# HADESD 实施规范

需求来源：source-requirements.md。用户本次指令优先：保留 daemon 的 Spring Boot 4.1.1，使用 Reactive 非阻塞架构。附件中的 MVC/JPA/Java21/Maven 版本要求被明确覆盖。

产品是一台安静的个人研究工作站：琥珀终端视觉，现代 DOM 阅读器，鼠标/命令/命令面板使用相同路由。中文界面，不虚构用户经历或统计。默认空站；演示内容须明确启用并标注。

后端：Java25、Boot4.1.1、Gradle9.7.1、WebFlux、R2DBC MySQL、Reactive Redis Session、Spring Security CSRF。阻塞的迁移/密码散列/文件探测只能在启动阶段或 boundedElastic 上运行，HTTP 数据库及 Redis 操作非阻塞。

事实数据 MySQL；不可变修订与乐观锁；草稿与线上快照隔离。公开静态站由冻结快照预渲染。独立 Worker 通过专用凭据领取任务，构建后原子切换 current，后端只读该 manifest 判断当前 release。

共享类型位于 packages/contracts/src/index.ts；HTTP /api/v1；集合统一 {items,page,size,total}；错误 Problem Details。端点契约详见 api-contract.md。

验收：真实写作/保存/发布/阅读，撤稿和回滚；安全与命令测试；浏览器桌面和移动端；无JS正文；静态404；实际构建体积；本地恢复演练。仅代码、本地服务与部署材料，不操作真实域名/生产账户。
