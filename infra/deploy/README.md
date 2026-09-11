# 生产源站手动备份与恢复

正式 `/usr/local/sbin/hadesd-compose` 包装器依次加载 `/opt/hadesd/app/infra/compose/compose.yaml`、`compose.production.yaml`、`compose.minio.yaml`，私有环境文件为 `/etc/hadesd/app.env`。MinIO 根凭据和独立应用凭据保存在该文件；正式 MinIO 不映射宿主机端口，不加载 `compose.minio.local.yaml`。已有 local 站点须完成下面的迁移后才能安装此三文件组合。备份脚本固定使用这些生产路径，不读取仓库 `.env`，不建立定时任务。

生产站点为 [hadesd.sh](https://hadesd.sh)。VPS Nginx 经 WireGuard 转发到内网 `10.77.0.2:18088`；源站使用 `hadesd.service` 管理 Compose。完整路径、服务检查、冻结快照发布与证书续期说明见 [生产部署文档](../../docs/deployment.md)。VPS 已安装 `renew-nginx.sh` 为 `/etc/letsencrypt/renewal-hooks/deploy/50-hadesd-nginx`，由现有 `certbot.timer` 续期成功后调用；备份仍是手动操作。

## 已有 local 站点切换 MinIO

1. 保留当前 local 包装器、存储模式及媒体目录。准备包含 `--storage-transfer` 的新版后端镜像；使用同一 Compose 项目、生产环境文件和生产 overlay，临时追加 `compose.minio.yaml`，仅启动 `minio` / `minio-init`，不重建正在使用 local 的 backend。
2. 冻结注册、写作、评论、上传、删除、发布和清理等业务写入。用仍指向 local 的正式包装器执行完整备份，确认 `COMPLETE`；此时不要提前改成 S3 模式，否则备份配置会与运行中的后端不一致。
3. 通过临时三文件组合的 `run --rm --no-deps backend` 执行 `--storage-transfer --from=local --to=s3`，默认仅预检；成功后追加 `--apply` 复制，再执行不带 `--apply` 的预检。覆盖数据库 `media` 与 `user_file` 的全部记录，须确认 `pending=0` 且 `alreadyPresent=examined`。目录使用容器内路径，默认迁移源为已挂载的 `/srv/media`。参数与校验含义见 [MinIO 迁移说明](../../docs/minio.md)。
4. 校验完成后才把三文件组合持久安装到正式包装器，将私有环境的存储模式设为 `s3`，重建 backend。核对实际存储配置、旧公开附件和私有文件可读后再开放写入。原媒体目录及停写备份继续保留。

**不能只更新包装器就启动全部服务**；`compose.minio.yaml` 会直接把 backend 切到 S3。S3 产生新写入后，如需回退 local，先停写，用 `--storage-transfer --from=s3 --to=local` 将全部当前数据库引用对象导出到新的独立 `STORAGE_TARGET_ROOT`，执行预检、`--apply` 和再次预检。校验完成后，使用不含 MinIO overlay 的 local 配置并把 `MEDIA_ROOT` 指向该新目录；直接切回旧目录会遗漏迁移后的附件。

## 手动备份

先安排**没有写作、注册、评论、上传、发布、撤稿、清理及配置变更**的静默窗口，再由 root 执行；脚本不停止服务，也不会自动阻止其他人的写入。

```sh
sudo /opt/hadesd/app/infra/deploy/backup-origin.sh
```

需要 Linux Bash、GNU coreutils、tar、flock 和已配置的 Compose 包装器。`storage-backup.sh` 必须与 `backup-origin.sh` 一起安装；S3 模式需要包含 `--storage-transfer` CLI 的新版后端镜像。环境文件应为 root 所有、`0600`；管理员密码文件 `/etc/hadesd/admin-password` 应为 UID 1000 所有、`0400`。每次新建 `/srv/hadesd/backups/<UTC时间戳>/`，外层目录归 root、`0700`，不覆盖历史备份：

- `database.sql`：整个应用 MySQL 数据库，包括表、数据、迁移记录、账号、存储过程、触发器及事件；使用 `--single-transaction`。密码仅在容器内通过 `MYSQL_PWD` 设置，不出现在参数或日志中。
- `media/`：本地模式复制原始媒体并保留权限和所有者；S3 模式从私有桶导出数据库 `media` 与 `user_file` 的全部当前对象，逐个验证记录大小及 SHA-256，再回读校验。桶的旧对象版本及孤立对象不包括在应用备份中。
- `published/`：保留发布版本及相对 `current` 符号链接，保留权限和所有者；排除发布根目录下的 `work/`、`staging/`。
- `storage-export.json`：S3 模式的校验导出结果；任何导出错误都会使备份失败。本地模式不生成此文件。
- `private/app.env`、`private/admin-password`：私有配置与密码，备份副本仅 root 可读。
- `database.sha256`、`current-manifest.sha256`、`summary.txt`：校验与非敏感摘要；`COMPLETE` 仅在所有步骤成功后生成。

未出现 `COMPLETE`、命令退出非零，或输出 `Backup incomplete`，都表示备份不可作为已验证恢复点；查看输出阶段后排除问题，在新的静默窗口重试。失败目录保留，不删除原始数据。`INCOMPLETE` 标记创建中或失败的目录；成功后由最后的原子改名生成 `COMPLETE`。

备份先启动一个临时后端容器读取存储配置的模式和摘要；若后端正在运行，再与该容器的实际配置比较。模式、桶、端点或凭据配置存在差异时，备份在 `storage_configuration` 阶段失败，须先协调实际配置。配置值和凭据不会输出。后端已经停止时，只能按包装器当前持久配置导出；因此维护窗口开始前应先确认配置一致。S3 导出临时容器只额外挂载本次新建的 `media/`，以 UID 0 写入 root 的备份目录，继续沿用后端的权限收缩和网络配置。

脚本比较备份前后线上 `current` 目标与清单散列，并比较复制后的清单；这能发现一般发布切换，**不能替代静默窗口或提供跨 MySQL 与文件系统的原子快照**。数据库校验验证转存文件完整性，不等于恢复演练。备份含账号哈希、私有草稿、文件与配置，应保持 root 私有，并在静默窗口结束后另行按运维策略做受控异机备份。Redis 会话及限流状态不在此备份中。

## 恢复到空数据库

恢复操作由运维人工完成，先验证 `COMPLETE`，并在备份目录运行：

```sh
sha256sum --check database.sha256 current-manifest.sha256
cmp current-manifest.json published/current/manifest.json
```

1. 在新机器或隔离恢复环境安装同版本应用、镜像和 Compose 包装器，保持业务入口关闭；不要让 backend / publisher 启动写入。为 MySQL 准备全新数据卷，使用与备份一致的数据库名称。**不要把 dump 导入已有业务数据库**：dump 含建库、切库及替换表语句。
2. 从 `private/app.env` 恢复 `/etc/hadesd/app.env`，设置 root 所有、`0600`；核对其中的路径与该机器一致。从 `private/admin-password` 恢复 `/etc/hadesd/admin-password`，设置 UID 1000 所有、`0400`。不要把文件内容输出到终端。
3. 将 `media/` 与 `published/` 复制到全新的 `/srv/hadesd/media`、`/srv/hadesd/published`，使用 `cp -a` 保留权限和相对链接。S3 备份中的 `media/` 是可校验的本地导出副本，恢复到桶的步骤见第 5 步。验证恢复后的 `published/current/manifest.json` 与备份清单一致；应用需要访问数据的目录仍应由 UID 1000 持有。
4. 仅启动 MySQL：`hadesd-compose up -d mysql`，等待健康检查通过。以 root 使用下面的命令，从备份目录导入；它会拒绝已存在任何表的应用数据库，不把数据库密码放入命令参数：

```sh
/usr/local/sbin/hadesd-compose exec -T mysql sh -eu -c '
  set +x +v
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  existing=$(mysql --user=root --database="$MYSQL_DATABASE" --batch --skip-column-names --execute="SHOW TABLES")
  test -z "$existing" || { printf "Refusing nonempty database\n" >&2; exit 1; }
  exec mysql --user=root
' < database.sql
```

5. 确认导入成功、迁移历史与管理员/用户数据齐全。恢复为本地存储时，须使用不含 MinIO overlay 的 local 配置；恢复为 S3 时，先准备一个独立私有桶，指向恢复的数据库，将 `STORAGE_SOURCE_ROOT` 指向备份的 `media/`，按 [MinIO 迁移说明](../../docs/minio.md) 执行 `--from=local --to=s3` 的预检和复制，确认再次预检 `pending=0` 后再启动业务入口。验证健康检查、登录、私有文件、公开附件及当前发布页面。使用全新的 Redis 状态会让旧会话失效，用户重新登录即可。

恢复的是完整账号与密码哈希，**不要运行 bootstrap 去覆盖或重新创建迁移过来的管理员**，也不要在未恢复数据库时先启动初始化流程。上述步骤不删除原有生产卷；正式切换前应在隔离环境完成恢复演练。
