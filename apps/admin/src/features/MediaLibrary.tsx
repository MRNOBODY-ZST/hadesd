import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminMedia, Media, MediaBatchDeleteResult } from "@hadesd/contracts";
import { api, errorMessage, privateMediaUrl, publicMediaUrl, type MediaFilters } from "../api";
import { navigate, useUi } from "../store";
import { dateTime, Empty, ErrorNotice, Loading, PageHeading, Pagination } from "../components/Shared";
import styles from "../styles.module.css";
import management from "./Management.module.css";
import { MEDIA_ACCEPT, validateUpload } from "./mediaInsertion";
import { runLimited, useDebouncedSearch, type BatchOutcome } from "./management";
export { validateUpload } from "./mediaInsertion";
const sizeLabel = (size: number) => size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
const typeOptions = [["all", "全部类型"], ["image", "图片"], ["text", "文本"], ["document", "PDF 文档"], ["archive", "ZIP 压缩包"]] as const;

export default function MediaLibrary({ compact = false, onInsert, onCover, onPending }: {
  compact?: boolean;
  onInsert?: (media: Media) => void;
  onCover?: (media: Media) => void;
  onPending?: (count: number) => void;
}) {
  const [page, setPage] = useState(0), [search, setSearch] = useState("");
  const query = useDebouncedSearch(search), size = compact ? 6 : 20;
  const [type, setType] = useState<NonNullable<MediaFilters["type"]>>("all");
  const [referenced, setReferenced] = useState<NonNullable<MediaFilters["referenced"]>>("all");
  const [localError, setLocalError] = useState<unknown>(null), [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<AdminMedia[] | null>(null), [discardHistory, setDiscardHistory] = useState(false);
  const [referenceFile, setReferenceFile] = useState<AdminMedia | null>(null);
  const [uploadResults, setUploadResults] = useState<BatchOutcome<File>[]>([]);
  const [deleteResults, setDeleteResults] = useState<{ files: AdminMedia[]; result: MediaBatchDeleteResult } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const input = useRef<HTMLInputElement>(null), all = useRef<HTMLInputElement>(null), uploadLock = useRef(false);
  const confirmationPanel = useRef<HTMLElement>(null);
  const client = useQueryClient();
  const media = useQuery({ queryKey: ["media", page, size, query, type, referenced], queryFn: ({ signal }) => api.media(page, { size, q: query, type, referenced }, signal) });
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      setProgress({ done: 0, total: files.length });
      return runLimited(files, async file => {
        const validation = validateUpload(file);
        if (validation) throw new Error(validation);
        return api.upload(file);
      }, done => setProgress({ done, total: files.length }), 3);
    },
    onSuccess: results => {
      setUploadResults(results);
      const succeeded = results.filter(result => result.ok).length;
      setNotice(`上传完成：成功 ${succeeded} 个，失败 ${results.length - succeeded} 个。`);
      if (succeeded) { setPage(0); void client.invalidateQueries({ queryKey: ["media"] }); }
    },
    onSettled: () => { uploadLock.current = false; },
  });
  const remove = useMutation({
    mutationFn: ({ files, discard }: { files: AdminMedia[]; discard: boolean }) => api.deleteMediaBatch(files.map(file => file.id), discard),
    onSuccess: (result, { files }) => {
      setDeleteResults({ files, result }); setConfirmation(null);
      const deleted = new Set(result.results.filter(item => ["DELETED", "NOT_FOUND"].includes(item.status)).map(item => item.id));
      setSelected(current => new Set([...current].filter(id => !deleted.has(id))));
      setReferenceFile(current => current && deleted.has(current.id) ? null : current);
      const count = result.results.filter(item => item.status === "DELETED").length;
      setNotice(`处理完成：删除 ${count} 个，${result.results.length - deleted.size} 个未删除。`);
      void client.invalidateQueries({ queryKey: ["media"] });
      void client.invalidateQueries({ queryKey: ["media-references"] });
    },
  });
  const busy = upload.isPending || remove.isPending;
  const items = media.data?.items ?? [];
  useEffect(() => {
    if (!confirmation) return;
    const previous = document.activeElement;
    confirmationPanel.current?.focus({ preventScroll: true });
    confirmationPanel.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [confirmation]);
  useEffect(() => { setSelected(new Set()); setConfirmation(null); }, [page, search, query, type, referenced]);
  useEffect(() => {
    if (all.current) all.current.indeterminate = selected.size > 0 && !items.every(item => selected.has(item.id));
  }, [items, selected]);
  useEffect(() => {
    if (media.data && page > 0 && page * size >= media.data.total) setPage(Math.max(0, Math.ceil(media.data.total / size) - 1));
  }, [media.data?.total, page, size]);
  useEffect(() => { onPending?.(upload.isPending ? progress.total - progress.done : 0); }, [upload.isPending, progress.done, progress.total, onPending]);
  useEffect(() => () => onPending?.(0), [onPending]);
  useEffect(() => {
    // The editor combines pending uploads with its own dirty state. On the
    // standalone page, use the same navigation guard until the batch settles.
    if (compact) return;
    useUi.getState().setDirty(false, busy);
    return () => useUi.getState().setDirty(false);
  }, [compact, busy]);
  useEffect(() => {
    if (!busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);
  function handleFiles(files: File[]) {
    if (!files.length || uploadLock.current || busy) return;
    if (files.length > 50) { setLocalError(new Error("每批最多选择 50 个文件，请分批上传。")); return; }
    uploadLock.current = true; setNotice(""); setLocalError(null); setUploadResults([]); setDeleteResults(null); upload.reset(); remove.reset(); upload.mutate(files);
  }
  function requestDelete(files: AdminMedia[]) {
    if (!files.length || busy) return;
    setDiscardHistory(false); setConfirmation(files); setDeleteResults(null); setNotice(""); remove.reset();
  }
  async function copy(file: Media) {
    try { await navigator.clipboard.writeText(publicMediaUrl(file.id)); setNotice("已复制引用路径。未发布资料保持私有，公开引用后才可访问。"); }
    catch { setLocalError(new Error("浏览器未允许复制，请从文件引用字段手动复制。")); }
  }
  return <section className={compact ? management.compact : undefined} aria-label={compact ? "编辑器媒体资料" : "媒体资料管理"}>
    {!compact && <PageHeading eyebrow="AN ARCHIVE OF YOUR MATERIALS" title="媒体资料" description="搜索、整理与批量管理资料；引用中的文件由服务器保护。" />}
    {compact ? <div className={management.compactTop}><h3>最近上传的资料</h3><button type="button" disabled={busy} onClick={() => input.current?.click()}>＋ 上传</button><button type="button" onClick={() => navigate({ view: "media" })}>全部资料 ↗</button></div>
      : <div className={styles.uploadArea} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); handleFiles(Array.from(event.dataTransfer.files)); }}>
        <span aria-hidden="true">↑</span><div><strong>{upload.isPending ? `正在上传 ${progress.done} / ${progress.total}…` : "拖入多个文件，或从电脑选择"}</strong><p>图片 ≤ 10 MB · PDF / ZIP ≤ 25 MB · 文本 ≤ 2 MB<br />每批最多 50 个文件，同时上传不超过 3 个。</p></div>
        <button disabled={busy} onClick={() => input.current?.click()}>选择文件</button>
      </div>}
    <input ref={input} aria-label="上传媒体文件" type="file" accept={MEDIA_ACCEPT} multiple className={styles.srOnly} disabled={busy} onChange={event => { handleFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <div className={management.toolbar}>
      <label className={management.search}>搜索资料<input type="search" aria-label="搜索全部媒体" placeholder="文件名关键词…" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
      <label>文件类型<select aria-label="媒体类型" value={type} onChange={event => { setType(event.target.value as typeof type); setPage(0); }}>{typeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {!compact && <label>引用状态<select aria-label="媒体引用状态" value={referenced} onChange={event => { setReferenced(event.target.value as typeof referenced); setPage(0); }}><option value="all">全部资料</option><option value="unused">未引用</option><option value="used">已引用</option></select></label>}
    </div>
    {compact && <p className={management.compactHint}>每页最多 6 项。搜索覆盖全部资料，可直接插入正文或设为封面。</p>}
    {upload.isPending && <p role="status">上传进度 {progress.done} / {progress.total}，请等待本批文件处理完成。</p>}
    {notice && <p className={styles.successNote} role="status">{notice}</p>}
    {!!(localError || upload.error || remove.error) && <ErrorNotice error={localError || upload.error || remove.error} />}
    {!!uploadResults.some(result => !result.ok) && <div className={management.feedback} role="status"><p>以下文件未上传，其余文件的结果已保存：</p><ul>{uploadResults.filter(result => !result.ok).map((result, index) => <li key={index} className={management.failed}>{result.item.name} — {!result.ok && errorMessage(result.error)}</li>)}</ul></div>}
    {deleteResults && <div className={management.feedback} role="status"><p>逐项处理结果</p><ul>{deleteResults.result.results.map(result => <li key={result.id} className={["DELETED", "NOT_FOUND"].includes(result.status) ? undefined : management.failed}>{deleteResults.files.find(file => file.id === result.id)?.filename ?? result.id} — {result.message}</li>)}</ul></div>}
    {!compact && !!items.length && <div className={management.batchBar}>
      <label className={management.check}><input ref={all} type="checkbox" aria-label="全选当前页媒体" disabled={busy} checked={items.every(file => selected.has(file.id))} onChange={event => setSelected(new Set(event.target.checked ? items.map(file => file.id) : []))} />全选当前页</label>
      <span>已选择 {selected.size} 项</span><button className={management.danger} disabled={busy || !selected.size} onClick={() => requestDelete(items.filter(file => selected.has(file.id)))}>删除所选</button>
    </div>}
    {confirmation && <section ref={confirmationPanel} tabIndex={-1} className={management.confirmation} aria-label="确认删除媒体">
      <h2>删除 {confirmation.length} 个文件</h2><p>{confirmation.map(file => file.filename).join("、")}</p><p>文件删除后不可恢复。最新草稿、已发布修订与保留的站点版本引用会阻止删除。</p>
      {confirmation.some(file => file.canDeleteHistory) && <label className={management.check}><input type="checkbox" checked={discardHistory} disabled={remove.isPending} onChange={event => setDiscardHistory(event.target.checked)} /><span>同时清理从未发布的旧修订中的附件引用；这些历史修订中的对应文件将无法恢复。最新草稿及已发布内容仍受保护。</span></label>}
      <p>{confirmation.filter(file => file.canDelete || discardHistory && file.canDeleteHistory).length} 项可以尝试删除；其余仍受引用保护。</p>
      <div className={management.confirmActions}><button disabled={remove.isPending} onClick={() => setConfirmation(null)}>取消</button><button className={styles.dangerButton} disabled={remove.isPending || !confirmation.some(file => file.canDelete || discardHistory && file.canDeleteHistory)} onClick={() => remove.mutate({ files: confirmation, discard: discardHistory })}>{remove.isPending ? "处理中…" : "确认删除所选"}</button></div>
    </section>}
    {referenceFile && !compact && <References key={referenceFile.id} file={referenceFile} onClose={() => setReferenceFile(null)} />}
    {media.isPending ? <Loading /> : media.error ? <ErrorNotice error={media.error} retry={() => void media.refetch()} /> : !items.length ? <Empty title={query || type !== "all" || referenced !== "all" ? "没有匹配的资料" : "资料架还是空的"}>{query || type !== "all" || referenced !== "all" ? "换一个关键词或筛选条件，搜索会覆盖整个资料库。" : "上传图片、PDF、ZIP 或 UTF-8 文本，编辑文章时可插入正文。"}</Empty>
      : <div className={compact ? management.compactList : styles.mediaList}>{items.map(file => <article className={compact ? management.compactCard : `${styles.mediaItem} ${management.card}`} data-selected={selected.has(file.id)} key={file.id}>
        {!compact && <label className={`${management.check} ${management.selection}`}><input type="checkbox" aria-label={`选择 ${file.filename}`} disabled={busy} checked={selected.has(file.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(file.id); else next.delete(file.id); return next; })} /></label>}
        <a href={privateMediaUrl(file.id)} className={`${styles.mediaThumb} ${management.thumb}`} target="_blank" rel="noreferrer" aria-label={`私有预览 ${file.filename}`}>
          {file.mime.startsWith("image/") ? <img src={privateMediaUrl(file.id)} alt={file.filename} loading="lazy" /> : <span>{file.mime === "application/pdf" ? "PDF" : file.mime === "application/zip" ? "ZIP" : "TXT"}<span>↗</span></span>}
        </a>
        <div className={`${styles.mediaInfo} ${management.info}`}><h2 title={file.filename}>{file.filename}</h2><p>{sizeLabel(file.size)}{!compact && ` · ${dateTime(file.createdAt)}`}</p>
          {!compact && <><span className={`${management.badge} ${file.referenceCount ? management.protected : ""}`}>{file.referenceCount ? `${file.referenceCount} 处引用${file.canDeleteHistory ? " · 仅旧草稿" : ""}` : "未引用"}</span><label className={styles.referenceLabel}>公开引用路径<input readOnly aria-label={`${file.filename} 引用路径`} value={publicMediaUrl(file.id)} onFocus={event => event.target.select()} /></label></>}
          <div className={`${styles.mediaActions} ${management.actions}`}>
            {!compact && <a href={`${privateMediaUrl(file.id)}?download=true`} download>下载文件</a>}
            {onInsert ? <button onClick={() => { onInsert(file); setNotice(`已插入 ${file.filename}。`); }}>插入正文</button> : <button onClick={() => void copy(file)}>复制引用</button>}
            {onCover && file.mime.startsWith("image/") && <button onClick={() => onCover(file)}>设为封面</button>}
            {!compact && <><button onClick={() => setReferenceFile(file)}>引用详情</button>{file.canDelete || file.canDeleteHistory ? <button className={styles.dangerLink} disabled={busy} onClick={() => requestDelete([file])}>{file.canDeleteHistory && !file.canDelete ? "清理后删除" : "删除"}</button> : <span className={management.compactHint}>引用保护中</span>}</>}
          </div>
        </div>
      </article>)}</div>}
    {media.data && <Pagination page={page} total={media.data.total} size={size} onChange={setPage} />}
    {!compact && <p className={management.compactHint}>未发布资料保持私有。引用路径在文章公开后才可访问；保留版本与草稿引用会阻止误删。</p>}
  </section>;
}

function References({ file, onClose }: { file: AdminMedia; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: "nearest", behavior: "instant" });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const query = useQuery({ queryKey: ["media-references", file.id, page], queryFn: ({ signal }) => api.mediaReferences(file.id, page, signal) });
  return <section ref={panel} tabIndex={-1} className={management.references} aria-label={`引用详情 ${file.filename}`}><header><h2>{file.filename} 的引用</h2><button aria-label="关闭引用详情" onClick={onClose}>×</button></header>
    {query.isPending ? <Loading /> : query.error ? <ErrorNotice error={query.error} retry={() => void query.refetch()} /> : !query.data.items.length ? <p>没有保留的引用，可以删除此文件。</p> : <><p>最新草稿（包括回收站）和已发布修订始终受保护。仅从未发布的旧修订可显式清理。</p><ul>{query.data.items.map((reference, index) => <li key={`${reference.kind}:${reference.revisionId}:${reference.releaseId}:${index}`}>
      <strong>{reference.title || "保留的站点版本"}</strong> · {reference.kind === "DRAFT" ? "最新草稿" : reference.kind === "HISTORY" ? "历史修订" : "站点版本"}{reference.deleted && " · 回收站"}{reference.kind === "RELEASE" && reference.current && " · 当前线上"}<br />
      <span>{reference.protected ? "受保护，不能删除附件" : "未发布的旧修订，可明确确认后清理附件"}</span>{reference.revisionId && <><br /><code>修订 {reference.revisionId}</code></>}{reference.releaseId && <><br /><code>版本 {reference.releaseId}</code></>}
      {reference.contentId && <div><button onClick={() => navigate({ view: "editor", id: reference.contentId! })}>查看文稿</button></div>}
    </li>)}</ul><Pagination page={page} total={query.data.total} size={query.data.size} onChange={setPage} /></>}
  </section>;
}
