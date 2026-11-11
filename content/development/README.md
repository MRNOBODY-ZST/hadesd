# 博客研发内容包

本目录保存可导入博客的 Markdown 源文，共四篇研发文章和两个固定页面。内容以当前仓库源码为依据，不包含私有配置、真实账户、主机地址或运行环境数据，也不把历史验证报告当作本轮执行结果。

## 文件与目标

| 文件 | frontmatter 类型 | slug | 公开路径 |
| --- | --- | --- | --- |
| `01-architecture.md` | `POST` | `building-hadesd-architecture` | `/posts/building-hadesd-architecture` |
| `02-terminal-crt.md` | `POST` | `building-hadesd-terminal-crt` | `/posts/building-hadesd-terminal-crt` |
| `03-atomic-publishing.md` | `POST` | `building-hadesd-atomic-publishing` | `/posts/building-hadesd-atomic-publishing` |
| `04-self-hosting-validation.md` | `POST` | `building-hadesd-self-hosting-validation` | `/posts/building-hadesd-self-hosting-validation` |
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

`ABOUT` 和 `NOW` 是本内容包的导入类别，**不是后端 API 的 ContentType**。导入时必须映射为 `PAGE`，并分别使用 `about`、`now` slug。其余四篇直接映射为 `POST`。语言字段可统一设为 `zh-CN`，不设置封面附件。

本目录的 `README.md` 没有 frontmatter，不能作为文章导入。不要把文件名、排序编号、导入说明或 frontmatter 原文拼进 Markdown 正文。

## 预览与导入

`scripts/publish-development.mjs` 按上表读取六个文件。可以先生成本地公开预览快照；这条命令不登录、不访问服务，也不发布内容：

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

核对后，导入并发布六项内容：

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

`--replace-demo` 只匹配原始四个示例 slug：`welcome-to-hadesd`、`two-ways-one-story`、`time-and-backpressure` 和 `hadesd-demo`。六项替换内容全部发布成功后，脚本才逐项撤下这些示例并移入回收站；它不会永久删除历史修订或附件。

另有 `--archive-qa` 可选参数，用于归档已知验收脚本生成的草稿。它要求内容类型为 `POST`，同时匹配生成式 slug（`qa-mouse-数字`、`qa-lifecycle-数字`、`admin-qa-数字`）与对应的精确测试标题，不按模糊关键词清理普通作者内容。可单独使用，也可与 `--replace-demo` 组合；原有回收站不会被清空。

发布失败时，旧示例仍保留；已经完成的单篇新发布不会自动回滚。应先核对后台任务和备份，再修复并重跑。不要绕过应用直接修改数据库行、公开快照或 `current` 指针。

## 校对要点

- 当前公开站在构建阶段预渲染，生产阅读由静态文件交付；文章没有把 Node Worker 描述为常驻页面 SSR 服务。
- 两种阅读前端共用冻结快照和一次公开指针切换；不同域名共用账号数据，但分别登录。
- 浏览器终端是公开内容的虚拟文件系统，不是宿主机 Shell。
- 开场与图形实现以当前代码为准，开发态前景对比面板没有被写成默认生产功能。
- 文章中的示例域名使用 `example.com`，示例命令不含真实密码、账号会话或私有部署路径。
- 后端测试和浏览器验证被描述为方法与覆盖范围；执行结果应由实际运行报告补充。
