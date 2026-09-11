import { useEffect, useState } from "react";
import { Markdown, MarkdownImage } from "@hadesd/markdown";
import type { BlogComment, Media, Page } from "@hadesd/contracts";
import { TerminalProgram } from "../shell/TerminalProgram";
import { useAccount } from "./Account";
import { FILE_ACCEPT, PageButtons } from "./AccountPanel";
import { community, errorText, fileSize, fileUrl } from "./api";

type Draft = { edit?: BlogComment; reply?: BlogComment };
function CommentComposer({ contentId, draft, onClose, onSaved }: { contentId: string; draft: Draft; onClose: () => void; onSaved: () => void }) {
  const { user, open } = useAccount();
  const [body, setBody] = useState(draft.edit?.body || ""), [attachments, setAttachments] = useState<Media[]>(draft.edit?.attachments || []);
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [files, setFiles] = useState<Page<Media> | null>(null), [filePage, setFilePage] = useState(0), [pick, setPick] = useState(false);
  useEffect(() => { if (!pick || !user) return; const c = new AbortController(); setFiles(null); void community.files(filePage, c.signal).then(setFiles).catch(e => { if (!c.signal.aborted) setError(errorText(e)); }); return () => c.abort(); }, [pick, filePage, user?.id]);
  async function upload(selected: File[]) {
    if (attachments.length + selected.length > 4) { setError("每条评论最多 4 个附件。"); return; }
    setBusy(true); setError("");
    try { for (const file of selected) { const uploaded = await community.upload(file); setAttachments(value => [...value, uploaded]); } }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (busy) return false;
    if (!user) { open("login"); return false; }
    if (!body.trim()) { setError("请填写评论内容。"); return false; }
    setBusy(true); setError("");
    const input = { body, attachmentIds: attachments.map(a => a.id), ...(draft.reply ? { parentId: draft.reply.parentId || draft.reply.id } : {}) };
    try { if (draft.edit) await community.editComment(draft.edit.id, input); else await community.addComment(contentId, input); onSaved(); return true; }
    catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  }
  return <TerminalProgram label={draft.edit ? "编辑评论" : draft.reply ? "回复评论" : "发表评论"} onClose={() => { if (!busy) onClose(); }}
    help=":wq 保存并返回 · :q / Esc / Ctrl+C 放弃编辑 · Tab 切换字段"
    onCommand={async command => command === ":wq" ? await save() ? "评论已保存。" : "评论尚未保存。" : "输入 :wq 保存评论，或 :q 返回。"}>
    <form className="community-panel community-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    {draft.reply && <p className="community-hint">回复 @{draft.reply.author.username}：{draft.reply.body.slice(0, 80)}</p>}
    <div className="community-tabs"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>预览</button></div>
    {preview ? <div className="community-comment-preview"><Markdown source={body || "*还没有评论内容。*"} /></div> : <label>评论内容<textarea data-autofocus aria-label="评论内容" required maxLength={4000} rows={7} value={body} onChange={e => setBody(e.target.value)} /></label>}
    <p className="community-hint">{body.length} / 4000 · 支持 Markdown、代码和数学公式。</p>
    <div className="community-attachment-actions"><label className="community-upload">＋ 上传附件<input type="file" aria-label="评论附件" accept={FILE_ACCEPT} multiple disabled={busy || !user || attachments.length >= 4} onChange={e => { const selected = [...e.target.files || []]; e.target.value = ""; if (selected.length) void upload(selected); }} /></label><button type="button" disabled={busy || !user} onClick={() => setPick(!pick)}>从我的文件选择</button></div>
    <ul className="community-attachments">{attachments.map(file => <li key={file.id}><span>{file.filename} · {fileSize(file.size)}</span><button type="button" disabled={busy} aria-label={`移除附件 ${file.filename}`} onClick={() => setAttachments(items => items.filter(a => a.id !== file.id))}>移除</button></li>)}</ul>
    {pick && <div className="community-file-picker" aria-label="选择已有文件">{files ? <><ul>{files.items.map(file => <li key={file.id}><button type="button" disabled={attachments.length >= 4 || attachments.some(a => a.id === file.id)} onClick={() => setAttachments(items => [...items, file])}>{file.filename} · {fileSize(file.size)}</button></li>)}</ul>{files.items.length === 0 && <p>暂无文件。</p>}<PageButtons data={files} onPage={setFilePage} /></> : <p>读取文件中…</p>}</div>}
    <p className="community-hint">发布后附件可公开访问。移除附件不会删除“我的文件”中的原文件。</p>
    {error && <p role="alert" className="community-error">{error}</p>}
    {user ? <button className="community-primary" type="submit" disabled={busy}>{busy ? "正在保存…" : draft.edit ? "保存修改" : draft.reply ? "发表回复" : "发表评论"}</button> : <button type="button" onClick={() => open("login")}>登录后继续，保留当前草稿</button>}
  </form></TerminalProgram>;
}
export function Comments({ contentId }: { contentId: string }) {
  const { user, open } = useAccount();
  const [data, setData] = useState<Page<BlogComment> | null>(null), [page, setPage] = useState(0), [version, setVersion] = useState(0);
  const [error, setError] = useState(""), [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState(false), [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => { setPage(0); setDraft(null); setDeleting(null); }, [contentId]);
  useEffect(() => {
    const c = new AbortController(); setError("");
    void community.comments(contentId, page, c.signal).then(value => { if (value.page > 0 && value.items.length === 0) setPage(value.page - 1); else setData(value); }).catch(e => { if (!c.signal.aborted) setError(errorText(e)); });
    return () => c.abort();
  }, [contentId, page, version]);
  function compose(value: Draft) { if (!user) { open("login"); return; } setDraft(value); }
  async function remove(comment: BlogComment) {
    setBusy(true); setError("");
    try { await community.deleteComment(comment.id, user?.role === "ADMIN" && comment.author.id !== user.id); setDeleting(null); setVersion(value => value + 1); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section id="comments" className="community-comments" aria-label="文章评论">
    <header><div><p className="eyebrow">COMMENTS / 留下一行</p><h2>评论{data ? ` (${data.total})` : ""}</h2></div><button onClick={() => compose({})}>{user ? "发表评论" : "登录后评论"}</button></header>
    <noscript><p>评论互动需要启用 JavaScript；文章正文可直接阅读。</p></noscript>
    {error && <p role="alert" className="community-error">{error}<button onClick={() => setVersion(v => v + 1)}>重试</button></p>}
    {!data && !error && <p role="status">正在读取评论…</p>}
    {data?.items.length === 0 && <p className="community-hint">这里还很安静。欢迎留下问题、补充或新的想法。</p>}
    <ol className="community-comment-list">{data?.items.map(comment => <li key={comment.id} id={`comment-${comment.id}`} data-comment-id={comment.id} className={comment.parentId ? "community-reply" : ""}>
      <div className="community-comment-meta"><strong>{comment.author.displayName}</strong><span>@{comment.author.username}</span>{comment.author.role === "ADMIN" && <span>作者</span>}<time dateTime={comment.createdAt}>{comment.createdAt.slice(0, 16).replace("T", " ")}</time>{comment.updatedAt !== comment.createdAt && <span>已编辑</span>}</div>
      {comment.parentId && <p className="community-reply-label">↳ 回复{data.items.find(c => c.id === comment.parentId)?.author.displayName || "较早的评论"}</p>}
      <Markdown source={comment.body} />
      {comment.attachments.length > 0 && <div className="community-comment-attachments">{comment.attachments.map(file => <div key={file.id}>{file.mime.startsWith("image/") && <MarkdownImage src={fileUrl(file.id, true)} alt={file.filename} />}<a href={fileUrl(file.id, true, true)} download={file.filename}>↓ {file.filename} <small>({fileSize(file.size)})</small></a></div>)}</div>}
      <div className="community-comment-actions"><button onClick={() => compose({ reply: comment })}>回复</button>{user?.id === comment.author.id && <button onClick={() => compose({ edit: comment })}>编辑评论</button>}{(user?.id === comment.author.id || user?.role === "ADMIN") && <button disabled={busy} onClick={() => setDeleting(comment.id)}>删除评论</button>}</div>
      {deleting === comment.id && <div className="community-delete-confirm"><span>确认删除这条评论及其公开附件引用？</span><button disabled={busy} onClick={() => void remove(comment)}>确认删除评论</button><button onClick={() => setDeleting(null)}>取消</button></div>}
    </li>)}</ol>
    {data && <PageButtons data={data} onPage={value => { setPage(value); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("hadesd:page", { detail: { anchor: "comments" } }))); }} />}
    {draft && <CommentComposer key={draft.edit?.id || draft.reply?.id || "new"} contentId={contentId} draft={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); setVersion(v => v + 1); if (!draft.edit && data) setPage(Math.floor(data.total / data.size)); }} />}
  </section>;
}
