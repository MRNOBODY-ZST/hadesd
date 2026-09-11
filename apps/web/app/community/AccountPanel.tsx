import { useEffect, useState, type FormEvent } from "react";
import type { BlogComment, Media, Page } from "@hadesd/contracts";
import { TerminalProgram } from "../shell/TerminalProgram";
import { useAccount, type AccountView } from "./Account";
import { community, errorText, fileSize, fileUrl } from "./api";

export const FILE_ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.zip,.txt,.md,.markdown,.json,.csv,.log,.yaml,.yml,.toml,.ini,.conf";
export function PageButtons({ data, onPage }: { data: { page: number; size: number; total: number }; onPage: (page: number) => void }) {
  return <nav className="community-pagination" aria-label="列表分页"><button type="button" disabled={!data.page} onClick={() => onPage(data.page - 1)}>上一页</button><span>{data.page + 1} / {Math.max(1, Math.ceil(data.total / data.size))} · {data.total} 项</span><button type="button" disabled={(data.page + 1) * data.size >= data.total} onClick={() => onPage(data.page + 1)}>下一页</button></nav>;
}
export function MyFiles() {
  const [page, setPage] = useState(0), [version, setVersion] = useState(0), [data, setData] = useState<Page<Media> | null>(null);
  const [error, setError] = useState(""), [loadError, setLoadError] = useState(""), [busy, setBusy] = useState(false), [confirmId, setConfirmId] = useState<string | null>(null), [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController(); setLoadError(""); setData(null);
    void community.files(page, controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setLoadError(errorText(e)); });
    return () => controller.abort();
  }, [page, version]);
  async function upload(files: File[]) {
    setBusy(true); setError(""); let completed = 0;
    try { for (const file of files) { setNotice(`正在上传 ${file.name}…`); await community.upload(file); completed++; } setNotice(`${completed} 个文件已上传。`); }
    catch (e) { setError(errorText(e)); setNotice(completed ? `${completed} 个文件已上传，剩余文件请重试。` : ""); }
    finally { setBusy(false); setPage(0); setVersion(v => v + 1); }
  }
  return <section aria-label="我的文件"><p className="community-hint">图片、PDF、ZIP 和文本；单文件最多 25 MiB，文本最多 2 MiB。文件默认私有，作为评论附件发布后才可公开下载。</p>
    <label className="community-upload">{busy ? "正在上传…" : "＋ 上传文件"}<input type="file" aria-label="上传文件" accept={FILE_ACCEPT} multiple disabled={busy} onChange={e => { const files = [...e.target.files || []]; e.target.value = ""; if (files.length) void upload(files); }} /></label>
    {notice && <p role="status">{notice}</p>}{error && <p className="community-error" role="alert">{error}</p>}
    {loadError && <p className="community-error" role="alert">{loadError}<button onClick={() => setVersion(v => v + 1)}>重试</button></p>}
    {!data && !loadError && <p role="status">读取文件中…</p>}
    {data?.items.length === 0 && <p>暂无文件。上传图片后，可在评论中选择它。</p>}
    <ul className="community-files">{data?.items.map(file => <li key={file.id}>
      {file.mime.startsWith("image/") && <a href={fileUrl(file.id)} target="_blank" rel="noreferrer"><img src={fileUrl(file.id)} alt={file.filename} /></a>}
      <div><strong>{file.filename}</strong><small>{fileSize(file.size)} · {file.createdAt.slice(0, 10)}</small><a href={fileUrl(file.id, false, true)} download={file.filename}>下载</a></div>
      <div>{confirmId === file.id ? <><span>删除此文件？</span><button disabled={busy} onClick={() => { setBusy(true); setError(""); void community.deleteFile(file.id).then(() => { setConfirmId(null); if (data.items.length === 1 && page) setPage(page - 1); else setVersion(v => v + 1); }).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>确认删除</button><button onClick={() => setConfirmId(null)}>取消</button></> : <button disabled={busy} onClick={() => setConfirmId(file.id)} aria-label={`删除文件 ${file.filename}`}>删除</button>}</div>
    </li>)}</ul>{data && <PageButtons data={data} onPage={setPage} />}
  </section>;
}
function MyComments() {
  const [page, setPage] = useState(0), [data, setData] = useState<Page<BlogComment> | null>(null), [error, setError] = useState("");
  useEffect(() => { const c = new AbortController(); setError(""); setData(null); void community.myComments(page, c.signal).then(setData).catch(e => { if (!c.signal.aborted) setError(errorText(e)); }); return () => c.abort(); }, [page]);
  return <section aria-label="我的评论">{error && <p role="alert" className="community-error">{error}</p>}{!data && !error && <p role="status">读取评论中…</p>}{data?.items.length === 0 && <p>还没有发表过评论。</p>}<ul className="community-files">{data?.items.map(comment => <li key={comment.id}><div><small>{comment.createdAt.slice(0, 19).replace("T", " ")}</small><p className="community-comment-excerpt">{comment.body}</p><span className="community-hint">{comment.attachments.length} 个附件 · {comment.parentId ? "回复" : "评论"}</span></div></li>)}</ul>{data && <PageButtons data={data} onPage={setPage} />}</section>;
}
export default function AccountPanel({ initialView, onClose }: { initialView: AccountView; onClose: () => void }) {
  const { user, setUser, logout, open } = useAccount();
  const [view, setView] = useState<AccountView>(initialView), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [username, setUsername] = useState(""), [displayName, setDisplayName] = useState(user?.displayName || ""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState(""), [currentPassword, setCurrentPassword] = useState("");
  const registering = view === "register", effective = user ? view : registering ? "register" : "login";
  useEffect(() => { if (user) setDisplayName(user.displayName); }, [user?.id]);
  useEffect(() => { setView(initialView); setError(""); setNotice(""); setPassword(""); setConfirm(""); setCurrentPassword(""); }, [initialView]);
  function switchView(next: AccountView) { setView(next); open(next); setError(""); setNotice(""); setPassword(""); setConfirm(""); setCurrentPassword(""); }
  async function authenticate(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (registering && password !== confirm) { setError("两次输入的密码不一致。"); return; }
    setBusy(true);
    let registered = false;
    try {
      if (registering) { await community.register({ username, displayName, password }); registered = true; }
      const account = await community.login(username, password); setUser(account); setDisplayName(account.displayName); setPassword(""); setConfirm(""); setView("profile"); setNotice(registering ? "注册成功，已登录。" : "登录成功。");
    } catch (e) { if (registered) { setView("login"); setNotice("账户已创建，请重试登录。"); setConfirm(""); } setError(errorText(e)); } finally { setBusy(false); }
  }
  return <TerminalProgram label="账户" onClose={onClose}
    help={user ? "profile · files · comments · logout · :q / Esc / Ctrl+C 返回" : "login · register · Tab 切换字段 · :q / Esc / Ctrl+C 返回"}
    onCommand={async command => {
      if (busy) return "正在处理，请稍候。";
      if (["login", "register", "profile", "files", "comments"].includes(command)) { switchView(command as AccountView); return command === "files" || command === "comments" ? "正在读取…" : "请填写下方账户字段。"; }
      if (command === "logout") { setBusy(true); try { await logout(); return "已退出登录。"; } catch (error) { return errorText(error); } finally { setBusy(false); } }
      return "输入 help 查看账户命令。密码请在密码字段中输入。";
    }}><div className="community-panel">
    <p className="community-program-path">account/{effective} {user ? `· @${user.username}` : "· guest"}</p>
    <nav className="community-tabs" aria-label="账户页面">{(user ? [["profile", "账户资料"], ["files", "我的文件"], ["comments", "我的评论"]] : [["login", "登录"], ["register", "注册"]]).map(([key, label]) => <button key={key} aria-current={effective === key ? "page" : undefined} disabled={busy} onClick={() => switchView(key as AccountView)}>{label}</button>)}</nav>
    {error && <p className="community-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!user ? <form className="community-form" onSubmit={event => void authenticate(event)}>
      <h2>{registering ? "创建读者账户" : "欢迎回来"}</h2>
      <label>用户名<input data-autofocus name="username" autoComplete="username" required pattern={registering ? "[a-z0-9][a-z0-9_.\\-]{2,31}" : undefined} maxLength={registering ? 32 : 100} value={username} onChange={e => setUsername(e.target.value)} /></label>
      {registering && <><p className="community-hint">3–32 位小写字母、数字、下划线、短横线或点。</p><label>显示名称<input name="displayName" autoComplete="nickname" required maxLength={60} value={displayName} onChange={e => setDisplayName(e.target.value)} /></label></>}
      <label>密码<input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? 12 : 1} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {registering && <><p className="community-hint">至少 12 个字符，最多 72 个 UTF-8 字节。</p><label>确认密码<input name="confirmPassword" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label></>}
      <button className="community-primary" type="submit" disabled={busy}>{busy ? "请稍候…" : registering ? "注册并登录" : "登录账户"}</button>
    </form> : effective === "files" ? <MyFiles /> : effective === "comments" ? <MyComments /> : <>
      <p className="community-hint">{user.username} · {user.role === "ADMIN" ? "站点管理员" : "读者"}</p>
      {user.role === "ADMIN" ? <p><a href="/admin/">进入写作台 →</a></p> : <>
        <form className="community-form" onSubmit={e => { e.preventDefault(); setBusy(true); setError(""); setNotice(""); void community.profile(displayName).then(value => { setUser(value); setNotice("显示名称已更新。"); }).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}><label>显示名称<input required maxLength={60} value={displayName} onChange={e => setDisplayName(e.target.value)} /></label><button type="submit" disabled={busy}>保存资料</button></form>
        <details className="community-password"><summary>修改密码</summary><form className="community-form" onSubmit={e => { e.preventDefault(); setError(""); setNotice(""); if (password !== confirm) { setError("两次输入的密码不一致。"); return; } setBusy(true); void community.password(currentPassword, password).then(() => { setUser(null); switchView("login"); setNotice("密码已更新，请使用新密码登录。"); }).catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>
          <label>当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
          <label>新密码<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>确认新密码<input type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          <button type="submit" disabled={busy}>更新密码并重新登录</button>
        </form></details>
      </>}
      <button disabled={busy} onClick={() => { setBusy(true); void logout().catch(e => setError(errorText(e))).finally(() => setBusy(false)); }}>退出登录</button>
    </>}
  </div></TerminalProgram>;
}
