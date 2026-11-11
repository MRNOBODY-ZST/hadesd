import { useEffect, useRef, useState, type FormEvent } from "react";
import { Markdown, MarkdownImage } from "@hadesd/markdown";
import type { BlogComment, Media, Page } from "@hadesd/contracts";
import { useAccount } from "./Account";
import { community, errorText, fileSize, fileUrl } from "./api";
type Composer = { editing?: BlogComment; parentId?: string; replyName?: string };
export function Comments({ contentId }: { contentId: string }) {
  const { user, open } = useAccount();
  const [data, setData] = useState<Page<BlogComment> | null>(null), [page, setPage] = useState(0), [revision, refresh] = useState(0);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [composer, setComposer] = useState<Composer | null>(null), [body, setBody] = useState(""), [attachments, setAttachments] = useState<Media[]>([]), [preview, setPreview] = useState(false), [deleting, setDeleting] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null), owner = useRef(user?.id), currentIdentity = useRef(user?.id);
  currentIdentity.current = user?.id;
  useEffect(() => {
    if (owner.current && user?.id && owner.current !== user.id) { setComposer(null); setBody(""); setAttachments([]); }
    if (user) owner.current = user.id;
  }, [user?.id]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    void community.comments(contentId, page, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      if (page && !result.items.length) setPage(Math.max(0, Math.ceil(result.total / result.size) - 1));
      else setData(result);
    }).catch(reason => { if (!controller.signal.aborted) setError(errorText(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [contentId, page, revision]);
  useEffect(() => { if (composer && user && !preview) input.current?.focus({ preventScroll: true }); }, [composer, user?.id, preview]);
  function compose(value: Composer = {}) {
    if (!user) { open("login"); return; }
    if (body.trim() && !window.confirm("放弃尚未提交的评论？")) return;
    setComposer(value); setBody(value.editing?.body || ""); setAttachments(value.editing?.attachments || []); setError(""); setNotice(""); setPreview(false);
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!user || !composer || busy || !body.trim()) return;
    const identity = user.id;
    setBusy(true); setError("");
    try {
      const value = { body: body.trim(), attachmentIds: attachments.map(file => file.id), ...(composer.parentId ? { parentId: composer.parentId } : {}) };
      if (composer.editing) await community.editComment(composer.editing.id, value);
      else await community.addComment(contentId, value);
      if (currentIdentity.current !== identity) return;
      setNotice(composer.editing ? "评论已更新。" : "评论已发表，谢谢你的分享。"); setComposer(null); setBody(""); setAttachments([]);
      if (!composer.editing && data) setPage(Math.floor(data.total / data.size)); refresh(value => value + 1);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function upload(files: File[]) {
    const identity = currentIdentity.current;
    if (!identity) return;
    if (attachments.length + files.length > 4) { setError("每条评论最多附加 4 个文件。"); return; }
    setBusy(true); setError("");
    try { for (const file of files) { if (currentIdentity.current !== identity) return; const uploaded = await community.upload(file); if (currentIdentity.current !== identity) return; setAttachments(previous => [...previous, uploaded]); } }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  async function remove(item: BlogComment) {
    setBusy(true); setError("");
    try { await community.deleteComment(item.id, user?.role === "ADMIN" && item.author.id !== user.id); setDeleting(null); refresh(value => value + 1); setNotice("评论已删除。"); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  }
  return <section className="discussion" aria-label="文章评论" aria-busy={loading}><header><div><p className="eyebrow">A CONVERSATION</p><h2>继续聊聊{data ? <span> {data.total}</span> : null}</h2></div><button className="pill-button secondary" onClick={() => compose()}>{user ? "写评论" : "登录后评论"}</button></header><p className="discussion-intro">问题、补充，或一个新的视角，都很欢迎。</p><noscript><p>启用 JavaScript 后可以阅读和参与评论。</p></noscript>
    {error && <p className="form-error" role="alert">{error}<button onClick={() => refresh(value => value + 1)}>重新读取</button></p>}{notice && <p role="status" className="form-success">{notice}</p>}
    {composer && <form className="comment-composer" onSubmit={event => void submit(event)}><div className="composer-heading"><strong>{composer.editing ? "编辑评论" : composer.replyName ? `回复 ${composer.replyName}` : "写下你的想法"}</strong><button type="button" disabled={busy} onClick={() => setPreview(!preview)}>{preview ? "继续编辑" : "预览 Markdown"}</button></div>
      {preview ? <div className="comment-preview"><Markdown source={body || "还没有写下文字。"} /></div> : <label><span className="sr-only">评论正文</span><textarea ref={input} value={body} maxLength={4000} required rows={6} placeholder="支持 Markdown，让讨论从这里开始。" onChange={event => setBody(event.target.value)} /></label>}
      {!!attachments.length && <ul className="attached-files">{attachments.map(file => <li key={file.id}>{file.filename}<button type="button" disabled={busy} aria-label={`移除 ${file.filename}`} onClick={() => setAttachments(items => items.filter(item => item.id !== file.id))}>×</button></li>)}</ul>}
      <div className="composer-bottom"><label className="attachment-button">＋ 附件<input aria-label="添加评论附件" type="file" multiple accept=".png,.jpg,.jpeg,.webp,.pdf,.zip,.txt,.md,.json,.csv,.log,.yaml,.yml,.toml,.ini,.conf" disabled={busy || attachments.length >= 4} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; if (files.length) void upload(files); }} /></label><span>{body.length} / 4000</span><button type="button" disabled={busy} onClick={() => { if (!body.trim() || window.confirm("放弃尚未提交的评论？")) { setComposer(null); setBody(""); } }}>取消</button><button className="pill-button" type="submit" disabled={busy || !user || !body.trim()}>{busy ? "处理中…" : "公开发表"}</button></div>{attachments.length > 0 && <p className="field-hint">随评论发表的附件将可公开下载。</p>}{!user && <p>请<button type="button" onClick={() => open("login")}>重新登录</button>后提交，文字仍保留。</p>}
    </form>}
    {loading && !data && <p role="status">正在读取讨论…</p>}{data?.items.length === 0 && !composer && <p className="discussion-empty">第一条想法，留给你。</p>}
    <ol className="comment-list">{data?.items.map(item => <li key={item.id} id={`comment-${item.id}`} className={item.parentId ? "is-reply" : undefined}><div className="comment-author"><span className="comment-avatar">{item.author.displayName.slice(0, 1)}</span><div><strong>{item.author.displayName}</strong><span>{item.author.role === "ADMIN" ? "作者 · " : ""}{item.createdAt.slice(0, 10)}{item.updatedAt !== item.createdAt && " · 已编辑"}</span></div></div>{item.parentId && <p className="reply-label">回复 {data.items.find(parent => parent.id === item.parentId)?.author.displayName || "较早的评论"}</p>}<Markdown source={item.body} />
      {!!item.attachments.length && <div className="comment-attachments">{item.attachments.map(file => <div key={file.id}>{file.mime.startsWith("image/") && <MarkdownImage src={fileUrl(file.id, true)} alt={file.filename} />}<a href={fileUrl(file.id, true, true)} download={file.filename}>↓ {file.filename} · {fileSize(file.size)}</a></div>)}</div>}
      <div className="comment-actions"><button disabled={busy} onClick={() => compose({ parentId: item.parentId || item.id, replyName: item.author.displayName })}>回复</button>{user?.id === item.author.id && <button disabled={busy} onClick={() => compose({ editing: item })}>编辑</button>}{(user?.id === item.author.id || user?.role === "ADMIN") && (deleting === item.id ? <><span>确认删除？</span><button disabled={busy} onClick={() => void remove(item)}>确认</button><button disabled={busy} onClick={() => setDeleting(null)}>取消</button></> : <button disabled={busy} onClick={() => setDeleting(item.id)}>删除</button>)}</div>
    </li>)}</ol>{data && data.total > data.size && <nav className="pagination" aria-label="评论分页"><button disabled={loading || !page} onClick={() => setPage(page - 1)}>← 上一页</button><span>{page + 1} / {Math.ceil(data.total / data.size)}</span><button disabled={loading || (page + 1) * data.size >= data.total} onClick={() => setPage(page + 1)}>下一页 →</button></nav>}
  </section>;
}
