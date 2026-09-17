import type { MetaFunction } from "react-router";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { publicIndex, snapshot, siteOrigin } from "../snapshot.server";
import { ContentList } from "../reader/ContentList";
import { pageMeta } from "../meta";
export function loader({ params }: LoaderFunctionArgs) {
  const tag = params.tag ?? "";
  const items = publicIndex.filter((c) => c.tags.includes(tag));
  if (!items.length) throw new Response("Not found", { status: 404 });
  return { tag, items, siteTitle: snapshot.site.title, siteOrigin };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  data
    ? pageMeta(
        "#" + data.tag,
        "按标签浏览公开内容",
        "/tags/" + encodeURIComponent(data.tag),
        data.siteTitle,
        data.siteOrigin,
      )
    : [];
export default function Tags() {
  const { tag, items } = useLoaderData<typeof loader>();
  return (
    <div className="standard-page">
      <div className="page-heading">
        <p className="eyebrow">INDEX / TAGS</p>
        <h1>
          <span className="accent">#</span>
          {tag}
        </h1>
        <p>沿着同一个线索，找到相关的记录。</p>
      </div>
      <ContentList items={items} />
    </div>
  );
}
