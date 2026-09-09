import { useState } from "react";
import { Link } from "react-router";
import type { PublicIndex } from "@hadesd/terminal-core";
function ContentRow({ item, index }: { item: PublicIndex; index: number }) {
  return (
    <div className="content-row">
      <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <Link to={item.route} className="content-title">
          {item.title}
          <span aria-hidden="true"> ↗</span>
        </Link>
        {item.summary && <p>{item.summary}</p>}
        <div className="row-tags">
          {item.tags.slice(0, 4).map((tag) => (
            <Link key={tag} to={`/tags/${encodeURIComponent(tag)}`}>
              #{tag}
            </Link>
          ))}
        </div>
      </div>
      <time dateTime={item.publishedAt}>{item.publishedAt.slice(0, 10)}</time>
    </div>
  );
}
export function ContentList({
  items,
  empty = "这里还没有发布内容。",
}: {
  items: PublicIndex[];
  empty?: string;
}) {
  const [visible, setVisible] = useState(20);
  return items.length ? (
    <>
      <div className="content-list">
        {items.slice(0, visible).map((item, i) => (
          <ContentRow key={item.id} item={item} index={i} />
        ))}
      </div>
      {visible < items.length && (
        <div className="load-more">
          <button
            type="button"
            onClick={() => setVisible((count) => count + 20)}
          >
            继续浏览 ↓
            <span>
              已显示 {visible} / {items.length}
            </span>
          </button>
        </div>
      )}
      <noscript>
        {items.length > 20 && (
          <details className="no-script-list">
            <summary>浏览剩余 {items.length - 20} 条内容</summary>
            {items.slice(20).map((item, i) => (
              <ContentRow key={item.id} item={item} index={i + 20} />
            ))}
          </details>
        )}
      </noscript>
    </>
  ) : (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        [ · ]
      </span>
      <div>
        <p>{empty}</p>
        <span>整理中的想法，会在准备好之后出现在这里。</span>
      </div>
    </div>
  );
}
