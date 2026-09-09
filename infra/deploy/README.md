# 生产源站手动备份与恢复

部署使用 `/usr/local/sbin/hadesd-compose` 包装器，加载 `/opt/hadesd/app/infra/compose/compose.yaml` 与 `compose.production.yaml`，私有环境文件为 `/etc/hadesd/app.env`。备份脚本固定使用这些生产路径，不读取仓库 `.env`，不建立定时任务。

生产站点为 [hadesd.sh](https://hadesd.sh)。VPS Nginx 经 WireGuard 转发到内网 `10.77.0.2:18088`；源站使用 `hadesd.service` 管理 Compose。完整路径、服务检查、冻结快照发布与证书续期说明见 [生产部署文档](../../docs/deployment.md)。VPS 已安装 `renew-nginx.sh` 为 `/etc/letsencrypt/renewal-hooks/deploy/50-hadesd-nginx`，由现有 `certbot.timer` 续期成功后调用；备份仍是手动操作。

## 手动备份

先安排**没有写作、注册、评论、上传、发布、撤稿、清理及配置变更**的静默窗口，再由 root 执行；脚本不停止服务，也不会自动阻止其他人的写入。

```sh
sudo /opt/hadesd/app/infra/deploy/backup-origin.sh
```

需要 Linux Bash、GNU coreutils、tar、flock 和已配置的 Compose 包装器。环境文件应为 root 所有、`0600`；管理员密码文件 `/etc/hadesd/admin-password` 应为 UID 1000 所有、`0400`。每次新建 `/srv/hadesd/backups/<UTC时间戳>/`，外层目录归 root、`0700`，不覆盖历史备份：

- `database.sql`：整个应用 MySQL 数据库，包括表、数据、迁移记录、账号、存储过程、触发器及事件；使用 `--single-transaction`。密码仅在容器内通过 `MYSQL_PWD` 设置，不出现在参数或日志中。
- `media/`、`published/`：媒体与保留发布版本，保留权限、所有者和相对 `current` 符号链接；排除发布根目录下的 `work/`、`staging/`。
- `private/app.env`、`private/admin-password`：私有配置与密码，备份副本仅 root 可读。
- `database.sha256`、`current-manifest.sha256`、`summary.txt`：校验与非敏感摘要；`COMPLETE` 仅在所有步骤成功后生成。

未出现 `COMPLETE`、命令退出非零，或输出 `Backup incomplete`，都表示备份不可作为已验证恢复点；查看输出阶段后排除问题，在新的静默窗口重试。失败目录保留，不删除原始数据。`INCOMPLETE` 标记创建中或失败的目录；成功后由最后的原子改名生成 `COMPLETE`。

脚本比较备份前后线上 `current` 目标与清单散列，并比较复制后的清单；这能发现一般发布切换，**不能替代静默窗口或提供跨 MySQL 与文件系统的原子快照**。数据库校验验证转存文件完整性，不等于恢复演练。备份含账号哈希、私有草稿、文件与配置，应保持 root 私有，并在静默窗口结束后另行按运维策略做受控异机备份。Redis 会话及限流状态不在此备份中。

## 恢复到空数据库

恢复操作由运维人工完成，先验证 `COMPLETE`，并在备份目录运行：

```sh
sha256sum --check database.sha256 current-manifest.sha256
cmp current-manifest.json published/current/manifest.json
```

1. 在新机器或隔离恢复环境安装同版本应用、镜像和 Compose 包装器，保持业务入口关闭；不要让 backend / publisher 启动写入。为 MySQL 准备全新数据卷，使用与备份一致的数据库名称。**不要把 dump 导入已有业务数据库**：dump 含建库、切库及替换表语句。
2. 从 `private/app.env` 恢复 `/etc/hadesd/app.env`，设置 root 所有、`0600`；核对其中的路径与该机器一致。从 `private/admin-password` 恢复 `/etc/hadesd/admin-password`，设置 UID 1000 所有、`0400`。不要把文件内容输出到终端。
3. 将 `media/` 与 `published/` 复制到全新的 `/srv/hadesd/media`、`/srv/hadesd/published`，使用 `cp -a` 保留权限和相对链接。验证恢复后的 `published/current/manifest.json` 与备份清单一致；应用需要访问数据的目录仍应由 UID 1000 持有。
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

5. 确认导入成功、迁移历史与管理员/用户数据齐全，再启动其余服务，验证健康检查、登录、私有文件、公开附件及当前发布页面。使用全新的 Redis 状态会让旧会话失效，用户重新登录即可。

恢复的是完整账号与密码哈希，**不要运行 bootstrap 去覆盖或重新创建迁移过来的管理员**，也不要在未恢复数据库时先启动初始化流程。上述步骤不删除原有生产卷；正式切换前应在隔离环境完成恢复演练。
