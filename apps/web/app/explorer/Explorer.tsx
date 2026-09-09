import { NavLink, Link } from "react-router";
import { useActions } from "../shell/actions";
import { usePreferences } from "../shell/store";
export function Explorer() {
  const { data, cwd } = useActions();
  const toggle = usePreferences((s) => s.toggle);
  const tags = Array.from(new Set(data.contents.flatMap((c) => c.tags))).slice(
    0,
    20,
  );
  return (
    <>
      <div className="explorer-caption">
        <span>EXPLORER</span>
        <span>−</span>
      </div>
      <nav
        aria-label="文件目录"
        className="explorer-tree"
        onClick={() => toggle("explorerOpen", false)}
      >
        <NavLink to="/" end className="tree-root">
          <span>⌄</span> ~/ <span className="muted">hadesd</span>
        </NavLink>
        <div className="tree-branches">
          {[
            ["posts", "文章"],
            ["projects", "项目"],
            ["research", "研究"],
          ].map(([path, label]) => (
            <div key={path}>
              <NavLink
                to={"/" + path}
                className={cwd === "/" + path ? "directory-active" : ""}
              >
                <span className="folder-icon">▱</span>
                {path}/
                <span className="tree-count">
                  {data.contents.filter((c) =>
                    c.route.startsWith("/" + path + "/"),
                  ).length || "—"}
                </span>
              </NavLink>
              {cwd === "/" + path &&
                data.contents
                  .filter((c) => c.route.startsWith("/" + path + "/"))
                  .slice(0, 20)
                  .map((c) => (
                    <NavLink key={c.id} to={c.route} className="tree-file">
                      <span>·</span>
                      {c.slug}.md
                    </NavLink>
                  ))}
            </div>
          ))}
          {[
            ["about", "about.md"],
            ["now", "now.md"],
            ["links", "links.json"],
          ].map(([route, label]) => (
            <NavLink key={route} to={"/" + route}>
              <span className="file-icon">≡</span>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <div className="explorer-caption tag-caption">
        TAGS{" "}
        <span>{tags.length ? String(tags.length).padStart(2, "0") : "—"}</span>
      </div>
      <div className="explorer-tags">
        {tags.length ? (
          tags.map((tag) => (
            <Link key={tag} to={"/tags/" + encodeURIComponent(tag)}>
              # {tag}
            </Link>
          ))
        ) : (
          <p>标签会随内容生长。</p>
        )}
      </div>
      <div className="explorer-bottom">
        <span className="tiny-symbol">✳</span>
        <p>a personal daemon.</p>
        <small>研究 · 工程 · 思考</small>
        <Link to="/links">LINKS ↗</Link>
        <a href="/rss.xml">RSS ↗</a>
      </div>
    </>
  );
}
