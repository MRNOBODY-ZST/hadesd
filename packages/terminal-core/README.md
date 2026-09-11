# HadesShell

浏览器中的虚拟终端解释器。公开内容来自当前发布版本；账号、评论和附件通过 WebFlux API 处理。命令不会在服务器上执行系统 Shell。

## 日常使用

```sh
pwd                         # /home/guest
ls                          # posts/ projects/ research/ about.md ...
cd ..                       # /home
cd ..                       # /
cd                          # 回到 /home/guest
cd ~/posts
cd -                        # 回到上次目录
md ~/about.md               # 将 Markdown、代码、图片加入终端历史
open ~/posts/example.md     # 同 md，可直接上下滚动阅读
cat ~/about.md              # 完整原文
vim ~/about.md              # 显式进入已有的 Vim 编辑器
head -n 8 ~/about.md
grep -in terminal ~/about.md
find ~ -name "*.md" -type f
wc -l ~/about.md
login                       # 用户名、密码逐项提示
register                    # 注册信息逐项提示
passwd                      # 私密提示中修改密码
files ls
files upload
comment ~/posts/example.md  # 逐行输入，单独输入 . 结束并确认发布
help                        # 完整命令列表
man grep                    # 单个命令说明
```

`ls` 支持 `-l`、`-a` 和组合选项。`head` / `tail` 默认 10 行。`grep` 按字面文本匹配，支持 `-i`、`-n`、`-v`；文件名通配仅在 `find -name` 中支持 `*`、`?`。`wc` 的行数按换行符计数，字节数按 UTF-8 计算。`echo` 以及路径参数支持 `$USER`、`${HOME}`、`$PWD` 等公开环境变量；单引号及反斜杠保留字面量。

输入历史最多保留 100 条，`clear` 清空可见输出，`history --clear` 清理命令历史。登录、注册、密码、账号及退出命令中的参数会先脱敏再进入历史。交互中的密码由网页层处理，不应送入解释器或 `CommandHistory`。

## 网页集成

- `createVfs(contents, username)` 建立 `/home/guest`、当前账号家目录以及公开文件的路径别名。别名有独立 `id`，保留原始 `contentId` 和 `route`。读取内置页面时应按 `route` 判断，不能只比较根目录 `path`。
- `Context.home` / `user` 表达真实会话目录。`normalizePath`、`resolveTarget`、`displayPath`、`completeAt` 都接受 `home`；没有传入时保留旧版根目录 `~` 的兼容行为。
- 提供 `Context.changeDirectory(path)` 后，`cd` 只改变 Shell 的目录。`about`、`now`、搜索等也返回终端输出，不改变 React Router 页面。网页层负责保存 `previousCwd`。
- `open`、`less`、`md`、`preview` 返回 `markdown` 输出；`vim` 返回 `file` 输出；`cat` 不再截断正文。异步读文件响应必须遵守 `AbortSignal`，取消后不返回过期内容。
- `Context.interact` 将账号等交互委托给网页文字提示流程。`Context.startedAt` 是当前终端会话开始时间，供 `uptime` 使用。

公开虚拟文件只读；Vim 中保存管理员草稿或读者本地副本沿用网页层的权限边界。文件上传和删除操作通过账号 API 完成。管道、重定向、串联命令及命令替换尚未实现；解析器会明确拒绝这些语法。
