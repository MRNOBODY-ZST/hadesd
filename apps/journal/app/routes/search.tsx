import { useEffect, useState } from "react";
import { Form, useSearchParams, useRouteLoaderData, type MetaFunction } from "react-router";
import type { Page, PublicContent } from "@hadesd/contracts";
import type { loader as rootLoader } from "../root";
import { siteOrigin, snapshot } from "../snapshot.server";
import { pageMeta } from "../meta";
import { PostList } from "../components/Content";
export function loader() { return { siteOrigin, siteTitle: snapshot.site.title }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => data ? pageMeta("搜索", "搜索已发布内容。", "/search", data.siteOrigin, data.siteTitle) : [];
export default function Search() {
  const [params] = useSearchParams(), q = params.get("q") || "", page = Math.max(0, Number(params.get("page")) || 0);
  const root = useRouteLoaderData<typeof rootLoader>("root")!;
  const [result, setResult] = useState<Page<PublicContent> | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setError(""); setResult(null); setLoading(!!q.trim());
    if (q.trim()) void fetch(`/api/v1/public/search?q=${encodeURIComponent(q)}&page=${page}&size=20&releaseId=${encodeURIComponent(root.releaseId)}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async response => { if (!response.ok) throw new Error(response.status === 409 ? "公开版本已更新，请刷新后重新搜索。" : "搜索暂时不可用，仍可通过文章目录阅读。"); return await response.json() as Page<PublicContent>; })
      .then(data => { if (!controller.signal.aborted) setResult(data); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [q, page, root.releaseId]);
  return <section className="section-width section-page search-page"><header className="page-heading"><h1>搜索</h1><p>输入关键词，搜索已发布内容。</p></header><Form className="search-form" action="/search" key={q}><label className="sr-only" htmlFor="search">搜索关键词</label><input id="search" name="q" type="search" maxLength={200} defaultValue={q} placeholder="搜索文章、项目、研究…" /><button type="submit" className="pill-button">搜索 →</button></Form><noscript><p>全文搜索需要 JavaScript。你仍可在<a href="/posts">文章目录</a>阅读公开记录。</p></noscript>
    {loading && <p role="status">正在搜索…</p>}{error && <p className="form-error" role="alert">{error}<button onClick={() => location.reload()}>刷新重试</button></p>}{result && <><p className="result-count">找到 {result.total} 条与「{q}」有关的记录</p><PostList items={result.items} empty="没有找到相关的文章。" /><a className="text-link" href="/search">清除搜索</a>{result.total > 20 && <nav className="pagination" aria-label="搜索分页">{page > 0 && <a href={`/search?q=${encodeURIComponent(q)}&page=${page - 1}`}>← 上一页</a>}<span>{page + 1} / {Math.ceil(result.total / 20)}</span>{(page + 1) * 20 < result.total && <a href={`/search?q=${encodeURIComponent(q)}&page=${page + 1}`}>下一页 →</a>}</nav>}</>}
  </section>;
}
