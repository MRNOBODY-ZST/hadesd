import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Markdown } from "@hadesd/markdown";
import type { Content, Revision, RevisionInput } from "@hadesd/contracts";
import { api, privateMediaUrl } from "../api";
import { navigate } from "../store";
import {
  dateTime,
  ErrorNotice,
  Loading,
  Pagination,
  typeNames,
  trapDialogFocus,
} from "../components/Shared";
import {
  inputFrom,
  useRevisionEditor,
  validRevision,
  type SaveStatus,
} from "./useRevisionEditor";
import { usePublish } from "./Publishing";
import MediaLibrary from "./MediaLibrary";
import { MEDIA_ACCEPT, mediaMarkdown } from "./mediaInsertion";
import { useMediaInsertion } from "./useMediaInsertion";
import attachmentStyles from "./EditorAttachments.module.css";
import styles from "../styles.module.css";
import management from "./Management.module.css";
const saveLabels: Record<SaveStatus, string> = {
  saved: "已保存",
  dirty: "未保存",
  saving: "保存中…",
  conflict: "版本冲突",
  error: "保存失败",
};
export default function Editor({ contentId }: { contentId: string }) {
  const content = useQuery({
    queryKey: ["content", contentId],
    queryFn: () => api.content(contentId),
  });
  if (content.isPending) return <Loading>正在展开你的记录…</Loading>;
  if (content.error)
    return (
      <ErrorNotice error={content.error} retry={() => void content.refetch()} />
    );
  return content.data.deletedAt ? <ArchivedDocument content={content.data} /> : <WritingDesk initial={content.data} />;
}
function ArchivedDocument({ content }: { content: Content }) {
  const client = useQueryClient();
  const restore = useMutation({ mutationFn: () => api.restoreContent(content.id, content.version), onSuccess: restored => {
    client.setQueryData(["content", content.id], restored);
    void client.invalidateQueries({ queryKey: ["contents"] });
    void client.invalidateQueries({ queryKey: ["media"] });
    void client.invalidateQueries({ queryKey: ["media-references"] });
  }, onError: () => { void client.invalidateQueries({ queryKey: ["content", content.id] }); } });
  return <section className={management.trashEditor} aria-label="回收站文稿">
    <p className={styles.eyebrow}>TRASH / PRIVATE MANUSCRIPT</p><h2>{content.latestRevision.title}</h2>
    <p>这份文稿已移入回收站。正文与历史修订仍保留，恢复后可以继续编辑；恢复不会自动发布。</p>
    <div className={management.confirmActions}><button onClick={() => navigate({ view: "contents" })}>返回内容列表</button><button className={styles.primary} disabled={restore.isPending} onClick={() => restore.mutate()}>{restore.isPending ? "恢复中…" : "恢复并继续编辑"}</button></div>
    {restore.error && <ErrorNotice error={restore.error} />}
    <Markdown source={content.latestRevision.markdown} mediaUrl={privateMediaUrl} />
  </section>;
}
function WritingDesk({ initial }: { initial: Content }) {
  const [pendingAttachments, setPendingAttachments] = useState(0);
  const [pendingLibraryFiles, setPendingLibraryFiles] = useState(0);
  const editor = useRevisionEditor(initial, pendingAttachments + pendingLibraryFiles);
  const { draft, change, content, status, dirty } = editor;
  const [mode, setMode] = useState<"write" | "split" | "preview">("split");
  const [inspector, setInspector] = useState<"details" | "history" | "media">(
    "details",
  );
  const [revisionPage, setRevisionPage] = useState(0);
  const [selectedRevision, setSelectedRevision] = useState(
    content.latestRevision.id,
  );
  const [historical, setHistorical] = useState<Revision | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [tagText, setTagText] = useState(draft.tags.join(", "));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachments = useMediaInsertion({ textarea, onPending: setPendingAttachments, update: updater => change(current => ({ ...current, markdown: updater(current.markdown) })) });
  const publish = usePublish();
  const revisions = useQuery({
    queryKey: ["revisions", content.id, revisionPage],
    queryFn: () => api.revisions(content.id, revisionPage),
  });
  useEffect(() => {
    setSelectedRevision(content.latestRevision.id);
  }, [content.latestRevision.id]);
  useEffect(() => {
    if (!historical) return;
    const element = dialogRef.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [historical?.id]);
  const field = <K extends keyof RevisionInput>(
    key: K,
    value: RevisionInput[K],
  ) => change((current) => ({ ...current, [key]: value }));
  const insertMarkdown = attachments.insert;
  async function inspectRevision(revision: Revision) {
    setHistoryError(null);
    try {
      setHistorical(await api.revision(content.id, revision.id));
    } catch (error) {
      setHistoryError(error);
    }
  }
  async function restoreRevision() {
    if (
      !historical ||
      (dirty &&
        !window.confirm(
          "恢复历史修订将替换当前未保存文字，并创建一个新修订。继续？",
        ))
    )
      return;
    const saved = await editor.save(inputFrom(historical));
    if (saved) {
      setHistorical(null);
      setTagText(saved.latestRevision.tags.join(", "));
    }
  }
  return (
    <>
      <header className={styles.editorHeader}>
        <div className={styles.editorBreadcrumb}>
          <button
            className={styles.iconButton}
            aria-label="返回内容列表"
            onClick={() => navigate({ view: "contents" })}
          >
            ←
          </button>
          <span>
            {typeNames[content.type]} <span className={styles.slash}>/</span>{" "}
            {draft.title || "未命名"}
          </span>
        </div>
        <div className={styles.editorActions}>
          <span
            role="status"
            className={`${styles.saveStatus} ${status === "conflict" || status === "error" ? styles.statusError : ""}`}
          >
            <i />
            {saveLabels[status]}
          </span>
          <button
            disabled={status === "saving" || !dirty || status === "conflict" || attachments.pending > 0 || pendingLibraryFiles > 0}
            onClick={() => void editor.save()}
          >
            立即保存
          </button>
          <button
            className={styles.primary}
            disabled={
              dirty ||
              status === "saving" ||
              status === "conflict" ||
              publish.isPending || attachments.pending > 0 || pendingLibraryFiles > 0
            }
            onClick={() => setPublishConfirm(!publishConfirm)}
          >
            发布 <span>↗</span>
          </button>
        </div>
      </header>
      {editor.error && status !== "conflict" && (
        <ErrorNotice error={editor.error} />
      )}
      {status === "conflict" && (
        <section className={styles.conflict} role="alert">
          <h2>另一处修改先抵达了服务器</h2>
          <p>
            你的文字已保留，自动保存已暂停。核对服务器最新版本后，选择载入它，或把当前文字作为新修订保存。
          </p>
          {editor.remote ? (
            <>
              <details>
                <summary>
                  查看服务器版本 v{editor.remote.version} ·{" "}
                  {editor.remote.latestRevision.title}
                </summary>
                <pre>{editor.remote.latestRevision.markdown}</pre>
              </details>
              <div className={styles.inlineActions}>
                <button
                  onClick={() => {
                    if (editor.loadRemote() && editor.remote)
                      setTagText(editor.remote.latestRevision.tags.join(", "));
                  }}
                >
                  载入服务器版本
                </button>
                <button onClick={() => void editor.mergeAsRevision()}>
                  以当前文字创建新修订
                </button>
              </div>
            </>
          ) : (
            <ErrorNotice
              error={editor.error}
              retry={() => void editor.save()}
            />
          )}
        </section>
      )}
      {publish.error && <ErrorNotice error={publish.error} />}
      {publishConfirm && (
        <section className={styles.publishConfirm}>
          <div>
            <p className={styles.eyebrow}>PUBLISH A FROZEN REVISION</p>
            <h2>让这份记录被看见</h2>
            <p>将所选修订提交为新站点版本。后续编辑仍作为私有草稿保存。</p>
            <label>
              本次发布的修订
              <select
                value={selectedRevision}
                onChange={(e) => setSelectedRevision(e.target.value)}
              >
                {!revisions.data?.items.some(
                  (r) => r.id === content.latestRevision.id,
                ) && (
                  <option value={content.latestRevision.id}>
                    最新保存 · {content.latestRevision.id.slice(0, 8)}
                  </option>
                )}
                {revisions.data?.items.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id === content.latestRevision.id ? "最新保存 · " : ""}
                    {dateTime(r.createdAt)} · {r.id.slice(0, 8)} · {r.title}
                  </option>
                ))}
              </select>
            </label>
            <small>修订 ID：{selectedRevision}</small>
          </div>
          <div className={styles.inlineActions}>
            <button onClick={() => setPublishConfirm(false)}>取消</button>
            <button
              className={styles.primary}
              disabled={dirty || status === "saving" || publish.isPending || attachments.pending > 0 || pendingLibraryFiles > 0}
              onClick={() =>
                publish.mutate(
                  {
                    operation: "PUBLISH",
                    contentId: content.id,
                    revisionId: selectedRevision,
                  },
                  { onSuccess: () => setPublishConfirm(false) },
                )
              }
            >
              {publish.isPending ? "提交中…" : "确认发布此修订"}
            </button>
          </div>
        </section>
      )}
      <div className={styles.desk}>
        <section className={styles.manuscript}>
          <div className={styles.titleBlock}>
            <p className={styles.eyebrow}>
              {typeNames[content.type]} / YOUR NEXT THOUGHT
            </p>
            <label className={styles.srOnly} htmlFor="content-title">
              内容标题
            </label>
            <input
              id="content-title"
              className={styles.titleInput}
              maxLength={200}
              placeholder="给想法一个名字"
              value={draft.title}
              onChange={(e) => field("title", e.target.value)}
            />
            <label className={styles.srOnly} htmlFor="content-summary">
              内容摘要
            </label>
            <textarea
              id="content-summary"
              className={styles.summaryInput}
              maxLength={1000}
              placeholder="写一段简短摘要，让读者知道从哪里开始…"
              value={draft.summary}
              onChange={(e) => field("summary", e.target.value)}
              rows={2}
            />
          </div>
          <div className={styles.editorToolbar}>
            <div className={styles.formatTools}>
              <button
                title="插入二级标题"
                aria-label="插入二级标题"
                onClick={() => insertMarkdown("## 标题")}
              >
                H₂
              </button>
              <button
                title="插入代码块"
                aria-label="插入代码块"
                onClick={() => insertMarkdown("```text\n\n```")}
              >
                {"{ }"}
              </button>
              <button
                title="插入引用"
                aria-label="插入引用"
                onClick={() => insertMarkdown("> 引用文字")}
              >
                ❞
              </button>
              <button
                title="插入链接"
                aria-label="插入链接"
                onClick={() =>
                  insertMarkdown("[链接文字](https://example.com)")
                }
              >
                ↗
              </button>
              <button title="上传并插入图片或附件" aria-label="上传并插入图片或附件" onClick={() => fileInput.current?.click()}>＋附件</button>
              <input ref={fileInput} type="file" accept={MEDIA_ACCEPT} multiple className={styles.srOnly} aria-label="选择正文附件" onChange={e => { void attachments.uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              <span className={styles.smallMuted}>Markdown</span>
            </div>
            <div className={styles.segmented}>
              {(
                [
                  ["write", "编辑"],
                  ["split", "分屏"],
                  ["preview", "预览"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={mode === value}
                  className={mode === value ? styles.segmentActive : ""}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={attachmentStyles.status}>
            <p className={attachmentStyles.help}>可拖放图片或附件、直接粘贴截图。支持表格、任务、脚注、数学、Mermaid、提示与折叠块。</p>
            <p role="status">{attachments.pending ? `正在上传 ${attachments.pending} 个文件，可继续输入…` : attachments.notice}</p>
            {attachments.error && <p className={attachmentStyles.error} role="alert">{attachments.error}</p>}
          </div>
          <div
            className={`${styles.writingArea} ${mode === "split" ? styles.split : ""}`}
            onDragOver={e => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }}
            onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); void attachments.uploadFiles(Array.from(e.dataTransfer.files)); } }}
          >
            {mode !== "preview" && (
              <div className={styles.sourcePane}>
                <label className={styles.paneLabel} htmlFor="markdown-source">
                  MARKDOWN
                </label>
                <textarea
                  id="markdown-source"
                  ref={textarea}
                  className={styles.markdownInput}
                  maxLength={2000000}
                  placeholder="从这里开始书写。\n\n支持 Markdown、代码、表格与数学公式。"
                  spellCheck={false}
                  value={draft.markdown}
                  onChange={(e) => field("markdown", e.target.value)}
                  onPaste={e => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void attachments.uploadFiles(files); } }}
                />
              </div>
            )}
            {mode !== "write" && (
              <section
                className={styles.previewPane}
                aria-label="私有 Markdown 预览"
              >
                <div className={styles.paneLabel}>
                  PRIVATE PREVIEW <span>仅自己可见</span>
                </div>
                {draft.coverMediaId && (
                  <img
                    className={styles.coverPreview}
                    src={privateMediaUrl(draft.coverMediaId)}
                    alt="文章封面预览"
                  />
                )}
                <Markdown
                  source={draft.markdown || "*想法落在纸上，便会出现在这里。*"}
                  mediaUrl={privateMediaUrl}
                />
              </section>
            )}
          </div>
          <div className={styles.writingFooter}>
            <span>
              {Array.from(draft.markdown).length.toLocaleString("zh-CN")} 字符{" "}
              <span className={styles.dot}>·</span> {draft.language}
            </span>
            <span>
              自动保存间隔 1.2 秒 <span className={styles.dot}>·</span> v
              {content.version}
            </span>
          </div>
        </section>
        <aside className={styles.inspector}>
          <div className={styles.inspectorTabs}>
            {(
              [
                ["details", "属性"],
                ["history", "修订"],
                ["media", "媒体"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={inspector === value}
                className={inspector === value ? styles.tabActive : ""}
                onClick={() => setInspector(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {inspector === "details" && (
            <div className={styles.inspectorBody}>
              <p className={styles.eyebrow}>DOCUMENT DETAILS</p>
              <label>
                永久链接标识
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  aria-label="永久链接标识"
                  value={draft.slug}
                  onChange={(e) => field("slug", e.target.value)}
                  maxLength={100}
                />
                <small>
                  {content.type === "PAGE" && "页面仅支持 about 或 now · "} /
                  {content.type === "PAGE"
                    ? ""
                    : `${{ POST: "posts", PROJECT: "projects", RESEARCH: "research" }[content.type]}/`}
                  {draft.slug}
                </small>
              </label>
              <label>
                语言
                <input
                  required
                  value={draft.language}
                  onChange={(e) => field("language", e.target.value)}
                  maxLength={20}
                  list="languages"
                />
                <datalist id="languages">
                  <option value="zh-CN" />
                  <option value="en" />
                  <option value="zh-TW" />
                </datalist>
              </label>
              <label>
                标签
                <input
                  value={tagText}
                  placeholder="系统, 网络, 随笔"
                  aria-label="标签"
                  onChange={(e) => {
                    setTagText(e.target.value);
                    field("tags", [
                      ...new Set(
                        e.target.value
                          .split(/[,，]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      ),
                    ]);
                  }}
                  onBlur={() => {
                    const tags = [
                      ...new Set(
                        tagText
                          .split(/[,，]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      ),
                    ];
                    if (JSON.stringify(tags) !== JSON.stringify(draft.tags))
                      field("tags", tags);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />
                <small>用逗号分隔，按 Enter 应用</small>
              </label>
              <div className={styles.tagList}>
                {draft.tags.map((tag) => (
                  <span className={styles.tag} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className={styles.coverField}>
                <span>封面图片</span>
                {draft.coverMediaId ? (
                  <>
                    <img
                      src={privateMediaUrl(draft.coverMediaId)}
                      alt="当前封面"
                    />
                    <button onClick={() => field("coverMediaId", null)}>
                      移除封面
                    </button>
                  </>
                ) : (
                  <button
                    className={styles.coverPlaceholder}
                    onClick={() => setInspector("media")}
                  >
                    ＋ 从媒体资料选择
                  </button>
                )}
              </div>
              <dl className={styles.documentMeta}>
                <div>
                  <dt>最新保存</dt>
                  <dd>{dateTime(content.latestRevision.createdAt)}</dd>
                </div>
                <div>
                  <dt>当前修订</dt>
                  <dd title={content.latestRevision.id}>
                    {content.latestRevision.id.slice(0, 12)}
                  </dd>
                </div>
              </dl>
              {!validRevision(draft) && (
                <p className={styles.warning}>
                  补全标题、链接标识与语言后，自动保存会继续。
                </p>
              )}
              <div className={styles.withdrawArea}>
                <p>撤稿会构建不包含此内容的新版本。</p>
                <button
                  className={styles.dangerButton}
                  disabled={publish.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "从公开站点撤下这份内容？私有草稿与历史修订会保留。",
                      )
                    )
                      publish.mutate({
                        operation: "WITHDRAW",
                        contentId: content.id,
                      });
                  }}
                >
                  从公开站点撤稿
                </button>
                <p>需要删除文稿时，可回到内容列表移入回收站；草稿和历史修订仍可恢复。</p>
                <button onClick={() => navigate({ view: "contents" })}>返回列表整理文稿</button>
              </div>
            </div>
          )}
          {inspector === "history" && (
            <div className={styles.inspectorBody}>
              <p className={styles.eyebrow}>IMMUTABLE HISTORY</p>
              <p className={styles.smallMuted}>
                每次保存都是独立修订。恢复会创建新修订，历史不会被改写。
              </p>
              {revisions.isPending ? (
                <Loading />
              ) : revisions.error ? (
                <ErrorNotice
                  error={revisions.error}
                  retry={() => void revisions.refetch()}
                />
              ) : (
                revisions.data?.items.map((r) => (
                  <button
                    key={r.id}
                    className={styles.historyRow}
                    onClick={() => void inspectRevision(r)}
                  >
                    <span className={styles.historyDot} />
                    <span>
                      <strong>{r.title}</strong>
                      <small>{dateTime(r.createdAt)}</small>
                      <code>
                        {r.id.slice(0, 8)}
                        {r.id === content.latestRevision.id ? " · 当前" : ""}
                      </code>
                    </span>
                  </button>
                ))
              )}
              {revisions.data && (
                <Pagination
                  page={revisionPage}
                  total={revisions.data.total}
                  size={20}
                  onChange={setRevisionPage}
                />
              )}
              {!!historyError && <ErrorNotice error={historyError} />}
            </div>
          )}
          {inspector === "media" && (
            <div className={styles.inspectorBody}>
              <MediaLibrary
                compact
                onPending={setPendingLibraryFiles}
                onInsert={(media) =>
                  insertMarkdown(
                    mediaMarkdown(media),
                  )
                }
                onCover={(media) => {
                  field("coverMediaId", media.id);
                  setInspector("details");
                }}
              />
            </div>
          )}
        </aside>
      </div>
      {historical && (
        <dialog
          ref={dialogRef}
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
          className={styles.revisionDialog}
          aria-labelledby="revision-title"
          onCancel={(e) => {
            e.preventDefault();
            setHistorical(null);
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setHistorical(null);
          }}
        >
          <section className={styles.historyModal}>
            <header>
              <div>
                <p className={styles.eyebrow}>
                  REVISION / {historical.id.slice(0, 8)}
                </p>
                <h2 id="revision-title">{historical.title}</h2>
                <p>{dateTime(historical.createdAt)}</p>
              </div>
              <button
                autoFocus
                aria-label="关闭历史修订"
                onClick={() => setHistorical(null)}
              >
                ×
              </button>
            </header>
            <div className={styles.historyPreview}>
              <Markdown
                source={historical.markdown}
                mediaUrl={privateMediaUrl}
              />
            </div>
            <footer>
              {!!editor.error && <ErrorNotice error={editor.error} />}
              <p>恢复此版本将创建新修订。</p>
              <button
                className={styles.primary}
                disabled={status === "saving" || attachments.pending > 0 || pendingLibraryFiles > 0}
                onClick={() => void restoreRevision()}
              >
                恢复为新修订
              </button>
            </footer>
          </section>
        </dialog>
      )}
    </>
  );
}
