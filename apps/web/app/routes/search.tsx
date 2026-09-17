import { useEffect, useRef, useState } from "react";
import { Form, useSearchParams, useRouteLoaderData } from "react-router";
import type { Page, PublicContent } from "@hadesd/contracts";
import type { loader as rootLoader } from "../root";
import { ContentList } from "../reader/ContentList";
import { pageMeta } from "../meta";
import type { MetaFunction } from "react-router";
import { snapshot, siteOrigin } from "../snapshot.server";
export function loader() { return { siteTitle: snapshot.site.title, siteOrigin }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  pageMeta("搜索", "在当前公开的记录中寻找线索。", "/search", data?.siteTitle, data?.siteOrigin);
export default function Search() {
  const [params] = useSearchParams();
  const query = params.get("q") ?? "";
  const page = Math.max(0, Number(params.get("page")) || 0);
  const data = useRouteLoaderData<typeof rootLoader>("root")!;
  const [result, setResult] = useState<Page<PublicContent> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++sequence.current;
    setResult(null);
    setError("");
    setLoading(false);
    if (!query.trim()) return;
    setLoading(true);
    fetch(
      `/api/v1/public/search?q=${encodeURIComponent(query)}&page=${page}&size=20&releaseId=${encodeURIComponent(data.releaseId)}`,
      { signal: controller.signal, headers: { Accept: "application/json" } },
    )
      .then(async (response) => {
        if (!response.ok) {
          let code = "";
          try {
            code = ((await response.json()) as { code?: string }).code ?? "";
          } catch {}
          throw new Error(
            code === "RELEASE_CHANGED"
              ? "站点内容已更新，请刷新页面后重新搜索。"
              : "搜索暂时不可用。已发布文章仍可通过目录阅读。",
          );
        }
        return response.json() as Promise<Page<PublicContent>>;
      })
      .then((value) => {
        if (request === sequence.current) setResult(value);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted && request === sequence.current)
          setError(reason.message);
      })
      .finally(() => {
        if (request === sequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [query, page, data.releaseId]);
  return (
    <div className="standard-page">
      <div className="page-heading">
        <p className="eyebrow">FIND / PUBLIC ARCHIVE</p>
        <h1>
          寻找线索<span className="accent">.</span>
        </h1>
        <p>搜索已公开的文章、项目与研究记录。</p>
      </div>
      <Form action="/search" className="search-form" key={query}>
        <label htmlFor="search-query" className="sr-only">
          搜索关键词
        </label>
        <span aria-hidden="true">⌕</span>
        <input
          id="search-query"
          name="q"
          defaultValue={query}
          maxLength={200}
          placeholder="搜索关键词…"
        />
        <button type="submit">搜索 ↵</button>
      </Form>
      <noscript>
        <p>
          全文搜索需要 JavaScript。你仍然可以通过<a href="/posts">文章目录</a>
          阅读全部已发布文章。
        </p>
      </noscript>
      {loading ? (
        <p role="status" className="search-status">
          正在搜索…
        </p>
      ) : error ? (
        <div role="alert" className="search-status">
          <p>{error}</p>
          <button onClick={() => location.reload()}>刷新重试</button>{" "}
          <a href="/posts">浏览目录 →</a>
        </div>
      ) : result ? (
        <>
          <p className="search-status mono">
            {result.total} RESULTS / “{query}”
          </p>
          <ContentList items={result.items} empty="没有找到相关公开内容。" />
          {result.total > 20 && (
            <nav className="pagination" aria-label="搜索分页">
              {page > 0 && (
                <a
                  href={`/search?q=${encodeURIComponent(query)}&page=${page - 1}`}
                >
                  ← 上一页
                </a>
              )}
              <span>
                {page + 1} / {Math.ceil(result.total / 20)}
              </span>
              {(page + 1) * 20 < result.total && (
                <a
                  href={`/search?q=${encodeURIComponent(query)}&page=${page + 1}`}
                >
                  下一页 →
                </a>
              )}
            </nav>
          )}
        </>
      ) : (
        <div className="search-hint">
          <span className="mono">search "a thought worth keeping"</span>
          <p>输入一个词，开始探索。</p>
        </div>
      )}
    </div>
  );
}
