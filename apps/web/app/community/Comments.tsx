import { useEffect, useRef, useState } from "react";
import { Markdown, MarkdownImage } from "@hadesd/markdown";
import type { BlogComment, Page } from "@hadesd/contracts";
import { useAccount } from "./Account";
import { community, errorText, fileSize, fileUrl } from "./api";

function command(text: string, comment?: BlogComment) {
  window.dispatchEvent(new CustomEvent("hadesd:terminal-command", { detail: { command: text, comment } }));
}
export function Comments({ contentId }: { contentId: string }) {
  const { user } = useAccount();
  const [data, setData] = useState<Page<BlogComment> | null>(null), [page, setPage] = useState(0), [version, setVersion] = useState(0);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const region = useRef<HTMLElement>(null), scrollAfterLoad = useRef(false);
  useEffect(() => { setPage(0); setData(null); }, [contentId]);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setLoading(true);
    void community.comments(contentId, page, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (value.page > 0 && value.items.length === 0) setPage(Math.max(0, Math.ceil(value.total / value.size) - 1));
      else { setData(value); setLoading(false); }
    }).catch(error => { if (!controller.signal.aborted) { setError(errorText(error)); setLoading(false); } });
    return () => controller.abort();
  }, [contentId, page, version]);
  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ contentId?: string; operation?: string }>).detail;
      if (detail?.contentId && detail.contentId !== contentId) return;
      if (detail?.operation === "created" && data) setPage(Math.floor(data.total / data.size));
      setVersion(value => value + 1);
    };
    window.addEventListener("hadesd:comments-updated", refresh);
    return () => window.removeEventListener("hadesd:comments-updated", refresh);
  }, [contentId, data?.total, data?.size]);
  useEffect(() => {
    if (loading || !scrollAfterLoad.current) return;
    scrollAfterLoad.current = false;
    region.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [loading, data]);
  function changePage(next: number) { scrollAfterLoad.current = true; setPage(next); }
  function interact(action: string, item?: BlogComment) {
    if (!user) command("login");
    else command(action === "comment" ? `comment ${contentId}` : `comment ${action} ${item!.id}`, item);
  }
  return <section ref={region} id={`comments-${contentId}`} className="community-comments" aria-label="文章评论" aria-busy={loading}>
    <header><div><p className="eyebrow">COMMENTS / 留下一行</p><h2>评论{data ? ` (${data.total})` : ""}</h2></div><button onClick={() => interact("comment")}>{user ? "发表评论" : "登录后评论"}</button></header>
    <p className="community-hint">评论、回复和编辑都在终端中逐行输入。输入 comment 开始，Ctrl+C 取消。</p>
    <noscript><p>评论互动需要启用 JavaScript；文章正文可直接阅读。</p></noscript>
    {error && <p role="alert" className="community-error">{error}<button onClick={() => setVersion(value => value + 1)}>重试</button></p>}
    {!data && !error && <p role="status">正在读取评论…</p>}
    {data?.items.length === 0 && <p className="community-hint">这里还很安静。欢迎留下问题、补充或新的想法。</p>}
    <ol className="community-comment-list">{data?.items.map(item => <li key={item.id} id={`comment-${item.id}`} data-comment-id={item.id} className={item.parentId ? "community-reply" : ""}>
      <div className="community-comment-meta"><strong>{item.author.displayName}</strong><span>@{item.author.username}</span>{item.author.role === "ADMIN" && <span>作者</span>}<time dateTime={item.createdAt}>{item.createdAt.slice(0, 16).replace("T", " ")}</time>{item.updatedAt !== item.createdAt && <span>已编辑</span>}</div>
      {item.parentId && <p className="community-reply-label">↳ 回复{data.items.find(parent => parent.id === item.parentId)?.author.displayName || "较早的评论"}</p>}
      <Markdown source={item.body} />
      {item.attachments.length > 0 && <div className="community-comment-attachments">{item.attachments.map(file => <div key={file.id}>{file.mime.startsWith("image/") && <MarkdownImage src={fileUrl(file.id, true)} alt={file.filename} />}<a href={fileUrl(file.id, true, true)} download={file.filename}>↓ {file.filename} <small>({fileSize(file.size)})</small></a></div>)}</div>}
      <div className="community-comment-actions"><button onClick={() => interact("reply", item)}>回复</button>{user?.id === item.author.id && <button onClick={() => interact("edit", item)}>编辑评论</button>}{(user?.id === item.author.id || user?.role === "ADMIN") && <button onClick={() => interact("delete", item)}>删除评论</button>}</div>
    </li>)}</ol>
    {data && <nav className="community-pagination" aria-label="评论分页"><button type="button" disabled={loading || data.page === 0} onClick={() => changePage(data.page - 1)}>上一页</button><span>{data.page + 1} / {Math.max(1, Math.ceil(data.total / data.size))} · {data.total} 条</span><button type="button" disabled={loading || (data.page + 1) * data.size >= data.total} onClick={() => changePage(data.page + 1)}>下一页</button></nav>}
  </section>;
}
