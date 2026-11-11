# 博客研发内容包

本目录保存可导入博客的 Markdown 源文，包含一篇项目回顾和两个固定页面。文章依据开发对话、提交记录和实际截图，讲述从设想到当前版本的变化；不包含私有凭据或连接信息。

## 文件与目标

| 文件 | frontmatter 类型 | slug | 公开路径 |
| --- | --- | --- | --- |
| `hadesd-story.md` | `POST` | `hadesd-from-an-idea-to-this-blog` | `/posts/hadesd-from-an-idea-to-this-blog` |
| `about.md` | `ABOUT` | `about` | `/about` |
| `now.md` | `NOW` | `now` | `/now` |

## 文件格式

每个内容文件以 YAML frontmatter 开头，包含且仅包含下列字段：

```yaml
---
slug: "example-slug"
title: "文章标题"
summary: "用于列表、搜索和页面元信息的摘要。"
type: POST
tags: ["博客研发", "主题标签"]
---
```

字符串使用 JSON 兼容的双引号写法，`tags` 使用 JSON 兼容的单行数组；结束分隔线之后的内容才是正文。正文没有重复的一级标题，由公开页面使用 `title` 生成页面标题。

`ABOUT` 和 `NOW` 是本内容包的导入类别，**不是后端 API 的 ContentType**。导入时必须映射为 `PAGE`，并分别使用 `about`、`now` slug。项目回顾直接映射为 `POST`。语言字段可统一设为 `zh-CN`，不设置封面附件。

本目录的 `README.md` 没有 frontmatter，不能作为文章导入。不要把文件名、排序编号、导入说明或 frontmatter 原文拼进 Markdown 正文。

## 预览与导入

`scripts/publish-development.mjs` 按上表读取三个文件。可以先生成本地公开预览快照；这条命令不登录、不访问服务，也不发布内容：

```sh
node scripts/publish-development.mjs --snapshot .local/development/snapshot.json
```

预览快照可以供两个阅读前端使用。文件只能输出到当前仓库的 `.local/` 下，不能与写入参数组合使用。正文变更后需要重新生成预览。

连接实际站点前，准备自己的私有环境文件。以下命令中的 `.local/editorial.env` 只是文件名示例，需要自行创建并设置 `API_ORIGIN`、`ADMIN_BOOTSTRAP_USERNAME` 和 `ADMIN_BOOTSTRAP_PASSWORD_FILE`。`API_ORIGIN` 必须明确指向目标实例；密码文件应保存该管理员当前有效密码，改过密码后不能继续使用旧的初始密码。

先查看计划：

```sh
node --env-file=.local/editorial.env scripts/publish-development.mjs
```

默认操作会登录并读取现有内容、设置与公开版本，展示目标站点及待处理内容，不修改业务数据。需要预览清理范围时，可在这一步增加下述清理参数，不加 `--apply` 就不会执行清理。

核对后，导入并发布三项内容：

```sh
node --env-file=.local/editorial.env scripts/publish-development.mjs --apply
```

脚本按 `(API type, slug)` 匹配现有内容：不存在时创建，存在时用版本号保存新修订，完全一致且已经公开时跳过。它会同时更新研发主题的标语、简介、首页文案、导航和源码链接，保留现有站点名称及开场标题。每项发布使用准确的内容与修订 ID，等待任务完成后再处理下一项。

写入前，脚本把已保存站点设置、活动内容、回收站、历史修订，以及包含当前公开设置和正文的公开快照备份到 `.local/backups/editorial-*/content-backup.json`，目录权限为 700、文件为 600。公开设置按发布 ID 读取，并在备份完成前再次核对公开版本；它与尚未发布的后台设置分开保存。这个 JSON 用于恢复内容操作，**不能替代数据库、媒体和发布目录的完整备份**。导入期间暂停其他编辑与发布，避免备份与后续操作交错。

## 可选的示例清理

如果目标实例仍有原始演示内容，可以明确开启清理：

```sh
node --env-file=.local/editorial.env scripts/publish-development.mjs --apply --replace-demo
```

`--replace-demo` 只匹配原始四个示例 slug：`welcome-to-hadesd`、`two-ways-one-story`、`time-and-backpressure` 和 `hadesd-demo`。三项替换内容全部发布成功后，脚本才逐项撤下这些示例并移入回收站；它不会永久删除历史修订或附件。

另有 `--archive-qa` 可选参数，用于归档已知验收脚本生成的草稿。它要求内容类型为 `POST`，同时匹配生成式 slug（`qa-mouse-数字`、`qa-lifecycle-数字`、`admin-qa-数字`）与对应的精确测试标题，不按模糊关键词清理普通作者内容。可单独使用，也可与 `--replace-demo` 组合；原有回收站不会被清空。

发布失败时，旧示例仍保留；已经完成的单篇新发布不会自动回滚。应先核对后台任务和备份，再修复并重跑。不要绕过应用直接修改数据库行、公开快照或 `current` 指针。

## 校对要点

- 文章讲述用户与 Codex 的实际协作过程，第一人称只使用开发记录支持的需求与反馈。
- 明确区分历史截图、本地试验和当前公开功能，不把试验清单当成正式站功能表。
- 不公开对话中的密码、会话、私有连接地址或后台资料；只使用用户已确认的公开域名。
- 保留架构与发布的大致分工，具体命令、版本和测试口径交给仓库文档。

## 用项目回顾替换旧四篇

已有旧版四篇研发文章的实例，可显式运行：

```sh
node --env-file=.local/editorial.env scripts/publish-development.mjs --apply --replace-development-series
```

先备份，再发布新文章和固定页，最后撤稿并将旧四篇移入回收站。只匹配 `POST` 类型和 `building-hadesd-architecture`、`building-hadesd-terminal-crt`、`building-hadesd-atomic-publishing`、`building-hadesd-self-hosting-validation` 四个精确 slug，不清空回收站，也不删除其他文章。可先去掉 `--apply` 查看范围。

旧文章 Markdown 已从当前内容包移除，保留在 Git 历史中；配图保留用于历史修订和回滚。新回顾的来源与图片说明见 [编辑依据](../../docs/editorial-content.md)。
