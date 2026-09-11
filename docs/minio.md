# MinIO 文件存储

博客正文、修订、账号和评论保存在 MySQL；站点发布快照保存在 `RELEASE_ROOT`；文章附件和用户附件共用私有 MinIO 桶。客户端继续使用 `/api/v1/admin/media`、`/api/v1/account/files` 和公开附件 API，文件权限由后端检查，桶无需公开访问，也无需浏览器直连 MinIO。

## 版本与构建

`infra/compose/Minio.Dockerfile` 从固定源码版本构建服务器 `RELEASE.2025-10-15T17-29-55Z` 与客户端 `RELEASE.2025-08-13T08-35-41Z`。服务器发布说明包含安全修复，并要求自行构建容器，不能把旧的预构建镜像当作该版本使用。[上游发布说明](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)。上游仓库已归档；后续升级需明确维护来源和测试结果。

```sh
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.minio.yaml build backend minio minio-init
```

初始化任务创建私有桶、启用对象版本、设置仅能访问该桶的应用账号。应用账号具有读取、写入、删除当前对象和列举桶的权限，不具有 MinIO 管理权限，也不能永久删除历史版本。桶策略参考 [MinIO 权限文档](https://min.io/docs/minio/linux/reference/minio-mc-admin/mc-admin-policy.html)。

## 准备配置

新安装执行 `pnpm setup`；已有安装执行：

```sh
node scripts/setup-minio.mjs
```

脚本只补充仓库根目录 `.env` 中缺失或空白的 MinIO/S3 配置，已有非空设置和 `STORAGE_MODE` 保留，密钥不会打印。`MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` 只供服务器和初始化任务使用；后端使用独立的 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`。已有外部 S3 配置会保留，操作前应核对它们是否就是准备使用的 MinIO 应用账号；普通 MinIO 用户凭据不应沿用 AWS 临时凭据的 `AWS_SESSION_TOKEN`。对主机运行的迁移/备份程序，必须确认 `S3_PATH_STYLE=true`；如果旧配置是 `false`，脚本会保留它，需明确修改。修改 `MINIO_PORT` 时，也应同步修改主机用的 `S3_ENDPOINT` 端口。

以下 `.env` 示例适用于本地 Compose 配置。生产站点使用 `/etc/hadesd/app.env`；配置脚本不会修改这个文件。生产操作必须沿用实际项目、环境文件和生产 overlay，并在既有 `/usr/local/sbin/hadesd-compose` 包装器中追加 `compose.minio.yaml`。这样服务管理、迁移和备份才会读取同一配置。构建包含新迁移 CLI 的后端镜像后再执行迁移；只构建 MinIO 镜像不会更新已存在的后端 JAR。

容器内使用 `S3_ENDPOINT=http://minio:9000` 和 `S3_PATH_STYLE=true`，区域及桶默认是 `us-east-1`、`hadesd-media`，可通过 `S3_REGION`、`S3_BUCKET` 修改。`compose.minio.yaml` 设置这些值。默认无宿主机端口、控制台关闭，服务只接入私有网络。若本地 Java 程序或迁移工具需要访问，额外叠加 `compose.minio.local.yaml`，仅向 `127.0.0.1:19000` 开放 S3 API。该可选 overlay 同时接入 `edge` 网络，因为 Docker 不会为仅接入内部网络的容器建立宿主机端口绑定。

先只启动存储和初始化服务即可准备桶；这一步不会替换正在运行的后端：

```sh
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.minio.yaml up -d --build minio minio-init
```

不要在尚未迁移附件的现有站点上直接启动全部服务。空白新安装可以在初始化成功后启动全部服务。已有站点遵循下面的迁移顺序。

## 从本地附件迁移

迁移覆盖数据库 `media` 与 `user_file` 的所有记录，因此修订历史、旧发布快照以及未公开用户附件都包括在内。工具读取数据库，不执行数据库迁移或修改记录，不删除源文件。

1. 先在隔离环境验证新后端、桶权限及上传/下载/发布流程。保留可恢复的数据库、发布目录和原附件备份。
2. 进入维护窗口，暂停上传、评论变更、附件删除、清理和发布等所有写入。仅暂停 publisher 不够，用户附件也会变动。
3. 保持当前后端使用本地存储，先执行预检。可通过临时后端容器读取原挂载目录和数据库，同时使用 MinIO 配置：

```sh
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.minio.yaml run --rm --no-deps backend --storage-transfer --from=local --to=s3
```

4. 检查预检成功，再添加 `--apply` 复制：

```sh
docker compose --env-file .env -f infra/compose/compose.yaml -f infra/compose/compose.minio.yaml run --rm --no-deps backend --storage-transfer --from=local --to=s3 --apply
```

5. 再次执行预检，确认 `pending=0` 且 `alreadyPresent=examined`。在环境文件中设置 `STORAGE_MODE=s3`，随后使用同一 MinIO overlay 重建/启动后端。验证文章图文、旧版本附件和用户附件，再开放写入。

本地 Java 运行方式（使用宿主机可达的 DB、S3 地址，先构建后端）：

```sh
node --env-file=.env scripts/storage-transfer.mjs --from=local --to=s3
node --env-file=.env scripts/storage-transfer.mjs --from=local --to=s3 --apply
```

源目录默认为 `MEDIA_ROOT`，可用 `STORAGE_SOURCE_ROOT` 指定。路径应为运行 Java 进程的环境中的绝对路径：宿主机命令使用宿主机路径，容器命令使用已经挂载且进程有权读取的容器路径（基础 Compose 的媒体目录为 `/srv/media`）。每个对象读取后校验数据库记录的大小和 SHA-256；目标存在时逐字节摘要比较，目标缺失才执行不可覆盖的写入，再次读取验证。任意不一致立即失败，不会覆盖冲突对象。中断后可重复执行；已成功复制的对象会再次验证并跳过。

早期数据库中 `media.sha256` 可能为空：工具会验证大小并比较源/目标新计算的 SHA-256，同时在 `legacyWithoutChecksum` 中报告数量；这只能证明复制一致，不能证明历史源文件未经损坏。工具不会悄悄回填数据库摘要。

JSON 输出含 `examined`、`copied`、`alreadyPresent`、`pending`、`legacyWithoutChecksum`、`bytes`、`dryRun`。设置 `STORAGE_TRANSFER_REPORT` 可以额外写入一个全新的报告文件，已有报告不会被覆盖。

## 备份与恢复

`scripts/backup.mjs` 根据 `STORAGE_MODE` 选择附件来源。S3 模式会调用同一个 Java 迁移工具，把数据库引用的全部当前对象导出到备份中的 `media/` 并逐个验证，再写入文件摘要清单。需要构建好的后端 JAR、Java 25、可达的 MySQL/S3 地址与读取权限。不要让容器使用 S3 而备份进程仍读取 `STORAGE_MODE=local`。

`pnpm backup` 使用 `infra/compose/dependencies.yaml` 的本地数据库服务，不能把本地开发数据库的转储当作生产备份。生产使用 `infra/deploy/backup-origin.sh` 及其 `storage-backup.sh` helper：它通过生产包装器比较运行中的后端与临时容器的存储模式及配置摘要，配置不一致则失败；本地模式保留目录复制，S3 模式通过新版后端容器执行校验导出，并保存 `storage-export.json`。导出失败会留下 `INCOMPLETE`，不会生成 `COMPLETE`。后端停止时使用生产包装器中的配置，因此停服务前应先确认配置已经持久化。生产路径、权限和恢复步骤见 [生产备份说明](../infra/deploy/README.md)。无论何种存储，整个数据库转储和附件导出期间都应暂停写入。

也可以显式导出附件供生产备份工具使用。先设置 `STORAGE_TARGET_ROOT` 为独立备份目录，再运行：

```sh
node --env-file=.env scripts/storage-transfer.mjs --from=s3 --to=local --apply
```

恢复到空 MinIO 桶时，先恢复数据库到隔离环境，将 `STORAGE_SOURCE_ROOT` 指向备份的 `media/`，执行 `--from=local --to=s3` 预检与复制，然后验证数据库/发布快照与附件。`restore:drill` 仍可校验备份的本地副本、全部文件摘要和恢复的表记录数。

这是博客应用当前有效对象的备份，不包含 MinIO 历史对象版本、用户/策略配置或未被数据库引用的孤立对象。需要完整 MinIO 灾备时，应另行备份或复制桶历史、MinIO 配置与密钥。版本控制可以恢复误删对象，但会累积历史空间；运行维护策略前必须确认保留期和可恢复性。

回退到本地存储之前，应暂停写入，将 MinIO 新增对象通过反向导出复制到一个独立目录，完成校验后再配置为新的 `MEDIA_ROOT`。不要直接切回迁移前的旧目录，否则迁移后上传的文件会缺失。

## 验证

不依赖 Docker 的测试：

```sh
node --test scripts/setup-minio.test.mjs
cd backend
./gradlew test --tests sh.hades.daemon.S3StorageProtocolTests --tests sh.hades.daemon.StorageTransferTests --tests sh.hades.daemon.MediaAndSearchTests --tests sh.hades.daemon.UserFileInspectorTests bootJar
```

完整 Testcontainers 测试需要 Docker，先构建上面的 MinIO 镜像；`MINIO_TEST_IMAGE` 可指定已经审查的等效镜像。真实协议集成测试验证私有对象写入、重复写入拒绝、读取、存在判断和删除。S3 HEAD 缺失可能只有通用 404，因此实现按状态判断，权限错误仍会向调用者报告。[AWS HEAD 行为](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)。

已有独立测试部署时，可以在其 publisher 镜像中运行 `node scripts/test-blog-storage.mjs`，设置 `HADESD_ISOLATED_TEST=true`、`API_ORIGIN=http://backend:8080` 并挂载该环境的管理员密码文件。脚本拒绝缺少隔离标识或使用公开主机名的目标；验证修订冲突、历史版本发布、附件读写、搜索隔离、读者权限、评论与回复、撤稿和回滚，最后恢复测试前的公开内容及站点设置。期间不要并行执行其他发布测试。标记为 QA 的不可变修订、历史媒体和测试账号会留在独立测试数据中；可通过 `HADESD_TEST_REPORT` 保存结果 JSON。
