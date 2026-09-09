import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@hadesd/markdown";
import { api } from "../api";
import { Empty, ErrorNotice, Loading, PageHeading, Pagination, dateTime } from "../components/Shared";
import styles from "../styles.module.css";
import "./Comments.css";

export default function Comments() {
  const client = useQueryClient(), [page, setPage] = useState(0), [confirmId, setConfirmId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["comments", page], queryFn: () => api.comments(page) });
  const remove = useMutation({ mutationFn: api.deleteComment, onSuccess: () => { setConfirmId(null); if (query.data?.items.length === 1 && page) setPage(page - 1); void client.invalidateQueries({ queryKey: ["comments"] }); } });
  return <><PageHeading eyebrow="CONVERSATIONS" title="评论管理" description="查看读者讨论，移除不适合公开的评论与附件引用。" />
    {query.isPending && <Loading />}{query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}{remove.error && <ErrorNotice error={remove.error} />}
    {query.data?.items.length === 0 && <Empty title="暂无评论">读者在文章下方发表的评论会出现在这里。</Empty>}
    <div className="admin-comments">{query.data?.items.map(comment => <article key={comment.id} data-comment-id={comment.id}>
      <header><strong>{comment.author.displayName}</strong><span>@{comment.author.username}</span><time>{dateTime(comment.createdAt)}</time><span>{comment.parentId ? "回复" : "评论"}</span></header>
      <Markdown source={comment.body} />
      {comment.attachments.length > 0 && <p className="admin-comment-files">{comment.attachments.map(file => <span key={file.id}>{file.filename}</span>)}</p>}
      <footer><code>文章 {comment.contentId}</code>{confirmId === comment.id ? <><span>确认移除？</span><button disabled={remove.isPending} className={styles.primary} onClick={() => remove.mutate(comment.id)}>确认删除评论</button><button onClick={() => setConfirmId(null)}>取消</button></> : <button onClick={() => setConfirmId(comment.id)}>删除评论</button>}</footer>
    </article>)}</div>
    {query.data && <Pagination page={page} size={query.data.size} total={query.data.total} onChange={setPage} />}
  </>;
}
