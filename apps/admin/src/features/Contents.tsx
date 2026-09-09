import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ContentType } from "@hadesd/contracts";
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
export function Contents() {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<ContentType | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<ContentType>("POST");
  const client = useQueryClient();
  const contents = useQuery({
    queryKey: ["contents", page],
    queryFn: () => api.contents(page),
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
  const items =
    contents.data?.items.filter(
      (c) =>
        (filter === "ALL" || c.type === filter) &&
        `${c.latestRevision.title} ${c.latestRevision.slug}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    ) || [];
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORDS, YOUR WORLD"
        title="内容手记"
        description="每一个想法，都值得被好好记录。"
        action={
          <button
            className={styles.primary}
            onClick={() => {
              setCreating(!creating);
              create.reset();
            }}
          >
            ＋ 新建内容
          </button>
        }
      />
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
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className={styles.searchField}>
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label="筛选当前页内容"
            placeholder="筛选当前页标题或链接…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
              ? "当前页没有匹配的记录"
              : "空白，是一个好的开始。"
          }
        >
          {search || filter !== "ALL"
            ? "调整筛选条件，或切换分页寻找其他记录。"
            : "新建一篇文章、一个项目或一份研究。保存的草稿仅你可见，发布后才会来到公开站点。"}
        </Empty>
      ) : (
        <div className={styles.contentList}>
          <div className={styles.listHeader}>
            <span>标题 / 内容</span>
            <span>最近保存</span>
            <span>修订</span>
          </div>
          {items.map((c) => (
            <button
              className={styles.contentRow}
              key={c.id}
              onClick={() => navigate({ view: "editor", id: c.id })}
            >
              <div className={styles.rowMain}>
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
              </div>
              <time dateTime={c.latestRevision.createdAt}>
                {dateTime(c.latestRevision.createdAt)}
              </time>
              <span className={styles.revisionLabel}>
                v{c.version}
                <span>→</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {contents.data && (
        <Pagination
          page={page}
          total={contents.data.total}
          size={20}
          onChange={setPage}
        />
      )}
      <div className={styles.pageNote}>
        <span>✳</span> 保存留住想法，发布让它被看见。草稿与线上版本始终独立。
      </div>
    </>
  );
}
