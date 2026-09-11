import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Content, ContentType } from "@hadesd/contracts";
import { api } from "../api";
import { navigate } from "../store";
import {
  dateTime,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
  typeNames,
} from "../components/Shared";
import styles from "../styles.module.css";
import management from "./Management.module.css";
import { useDebouncedSearch } from "./management";
export function Contents() {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ContentType | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const query = useDebouncedSearch(search);
  const [trash, setTrash] = useState(false);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<ContentType>("POST");
  const client = useQueryClient();
  const contents = useQuery({
    queryKey: ["contents", page, query, filter, trash],
    queryFn: ({ signal }) => api.contents(page, { q: query, type: filter === "ALL" ? "all" : filter, trash }, signal),
  });
  const create = useMutation({
    mutationFn: () =>
      api.create(type, {
        title: title.trim(),
        slug: slug.trim(),
        summary: "",
        markdown: "",
        tags: [],
        language: "zh-CN",
        coverMediaId: null,
      }),
    onSuccess: (content) => {
      void client.invalidateQueries({ queryKey: ["contents"] });
      navigate({ view: "editor", id: content.id });
    },
  });
  const move = useMutation({
    mutationFn: async ({ content, action }: { content: Content; action: "restore" | "trash" | "purge" }) => {
      if (action === "restore") await api.restoreContent(content.id, content.version);
      else if (action === "purge") await api.purgeContent(content.id, content.version);
      else await api.trashContent(content.id, content.version);
    },
    onSuccess: (_, { content, action }) => {
      setNotice(action === "restore" ? `「${content.latestRevision.title}」已恢复为私有草稿，尚未上线。` : action === "purge" ? `「${content.latestRevision.title}」及其修订已永久删除。媒体文件仍保留在资料库。` : `「${content.latestRevision.title}」已移入回收站，可随时恢复。`);
      if (contents.data?.items.length === 1 && page > 0) setPage(page - 1);
      void client.invalidateQueries({ queryKey: ["contents"] });
      void client.invalidateQueries({ queryKey: ["content", content.id] });
      void client.invalidateQueries({ queryKey: ["media"] });
      void client.invalidateQueries({ queryKey: ["media-references"] });
    },
    onError: () => { void client.invalidateQueries({ queryKey: ["contents"] }); },
  });
  const items = contents.data?.items || [];
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORDS, YOUR WORLD"
        title="内容手记"
        description="每一个想法，都值得被好好记录。"
        action={
          !trash && <button
            className={styles.primary}
            disabled={move.isPending || create.isPending}
            onClick={() => {
              setCreating(!creating);
              create.reset();
            }}
          >
            ＋ 新建内容
          </button>
        }
      />
      <div className={management.scope}>
        <div className={management.tabs} aria-label="文稿范围">
          <button aria-pressed={!trash} disabled={move.isPending || create.isPending} onClick={() => { setTrash(false); setPage(0); move.reset(); }}>文稿</button>
          <button aria-pressed={trash} disabled={move.isPending || create.isPending} onClick={() => { setTrash(true); setPage(0); setCreating(false); move.reset(); }}>回收站</button>
        </div>
        <p>{trash ? "恢复不会自动上线。仅从未发布、无保留版本或评论引用的文稿可永久删除。" : "已上线的内容须先撤稿，随后才能移入回收站。"}</p>
      </div>
      {notice && <p className={styles.successNote} role="status">{notice}</p>}
      {move.error && <ErrorNotice error={move.error} />}
      {creating && (
        <form
          className={styles.createForm}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className={styles.formTitle}>
            <h2>开始一份新记录</h2>
            <button
              type="button"
              onClick={() => setCreating(false)}
              aria-label="关闭新建内容"
            >
              ×
            </button>
          </div>
          <div className={styles.formGrid}>
            <label>
              内容类型
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ContentType)}
              >
                {Object.entries(typeNames).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              标题
              <input
                required
                maxLength={200}
                autoFocus
                placeholder="一个值得写下的想法"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              永久链接标识
              <input
                required
                maxLength={100}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="my-first-note"
                aria-label="永久链接标识"
                aria-describedby="create-slug-help"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
              <small id="create-slug-help">
                {type === "PAGE"
                  ? "页面仅支持 about（关于）或 now（近况）"
                  : "小写英文、数字，用连字符分隔"}
              </small>
            </label>
          </div>
          {create.error && <ErrorNotice error={create.error} />}
          <button className={styles.primary} disabled={create.isPending}>
            {create.isPending ? "创建中…" : "创建并开始写作 →"}
          </button>
        </form>
      )}
      <div className={styles.listToolbar}>
        <div className={styles.tabs} aria-label="内容类型筛选">
          {(
            [["ALL", "全部"], ...Object.entries(typeNames)] as [
              ContentType | "ALL",
              string,
            ][]
          ).map(([value, label]) => (
            <button
              aria-pressed={filter === value}
              className={filter === value ? styles.tabActive : ""}
              key={value}
              onClick={() => { setFilter(value); setPage(0); }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={styles.searchField}>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="搜索全部文稿"
            placeholder="搜索标题或链接…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </label>
      </div>
      {contents.isPending ? (
        <Loading />
      ) : contents.error ? (
        <ErrorNotice
          error={contents.error}
          retry={() => void contents.refetch()}
        />
      ) : !items.length ? (
        <Empty
          title={
            search || filter !== "ALL"
              ? "没有匹配的记录"
              : trash ? "回收站是空的" : "空白，是一个好的开始。"
          }
        >
          {search || filter !== "ALL"
            ? "调整筛选条件，搜索会覆盖全部记录。"
            : trash ? "移入回收站的文稿会保留在这里，直到你恢复它。" : "新建一篇文章、一个项目或一份研究。保存的草稿仅你可见，发布后才会来到公开站点。"}
        </Empty>
      ) : (
        <div className={styles.contentList}>
          <div className={`${styles.listHeader} ${management.contentRow}`}>
            <span>标题 / 内容</span>
            <span>最近保存</span>
            <span>修订</span>
            <span>操作</span>
          </div>
          {items.map((c) => (
            <article
              className={`${styles.contentRow} ${management.contentRow}`}
              key={c.id}
            >
              <button className={`${styles.rowMain} ${management.contentOpen}`} onClick={() => navigate({ view: "editor", id: c.id })}>
                <span className={styles.fileIcon} aria-hidden="true">
                  {c.type === "PROJECT"
                    ? "◇"
                    : c.type === "RESEARCH"
                      ? "⌁"
                      : "▤"}
                </span>
                <div>
                  <h2>{c.latestRevision.title}</h2>
                  <p>
                    <span>{typeNames[c.type]}</span>
                    <span className={styles.dot}>·</span>/
                    {c.latestRevision.slug}
                    {c.latestRevision.tags.slice(0, 2).map((t) => (
                      <span className={styles.tag} key={t}>
                        {t}
                      </span>
                    ))}
                  </p>
                </div>
              </button>
              <time dateTime={c.latestRevision.createdAt}>
                {dateTime(c.latestRevision.createdAt)}
              </time>
              <span className={styles.revisionLabel}>
                v{c.version}
                <span>→</span>
              </span>
              <div className={management.rowActions}>
                <button className={trash ? "" : management.danger} disabled={move.isPending || contents.isFetching} onClick={() => {
                  move.reset(); setNotice("");
                  if (!trash && !window.confirm(`将「${c.latestRevision.title}」移入回收站？草稿和历史修订会保留。已上线的内容需要先撤稿。`)) return;
                  move.mutate({ content: c, action: trash ? "restore" : "trash" });
                }}>{trash ? "恢复文稿" : "移入回收站"}</button>
                {trash && <button className={management.danger} disabled={move.isPending || contents.isFetching} onClick={() => {
                  move.reset(); setNotice("");
                  if (!window.confirm(`永久删除「${c.latestRevision.title}」？文稿及全部历史修订将不可恢复。媒体文件仍保留在资料库，可随后清理。曾发布或仍有评论、保留版本引用的文稿不能永久删除。`)) return;
                  move.mutate({ content: c, action: "purge" });
                }}>永久删除</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      {contents.data && (
        <Pagination
          page={page}
          total={contents.data.total}
          size={contents.data.size}
          onChange={setPage}
        />
      )}
      <div className={styles.pageNote}>
        <span>✳</span> 保存留住想法，发布让它被看见。草稿与线上版本始终独立。
      </div>
    </>
  );
}
