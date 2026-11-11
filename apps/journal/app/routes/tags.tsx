import { useLoaderData, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { publicIndex, siteOrigin, snapshot } from "../snapshot.server";
import { pageMeta } from "../meta";
import { PostList } from "../components/Content";
export function loader({ params }: LoaderFunctionArgs) { const tag = params.tag || "", items = publicIndex.filter(c => c.tags.includes(tag)); if (!items.length) throw new Response("Not found", { status: 404 }); return { tag, items, siteOrigin, siteTitle: snapshot.site.title }; }
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => data ? pageMeta(`#${data.tag}`, `关于 ${data.tag} 的公开记录`, `/tags/${encodeURIComponent(data.tag)}`, data.siteOrigin, data.siteTitle) : [];
export default function Tags() { const { tag, items } = useLoaderData<typeof loader>(); return <section className="section-width section-page"><header className="page-heading"><p className="eyebrow">EXPLORE A THREAD</p><h1><span className="muted">#</span>{tag}</h1><p>{items.length} 篇记录，沿着同一个线索。</p></header><PostList items={items} /></section>; }
