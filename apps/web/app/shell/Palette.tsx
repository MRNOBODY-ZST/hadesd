import { useState } from "react";
import { commands, navigationFor } from "@hadesd/terminal-core";
import { useActions } from "./actions";
import { TerminalProgram } from "./TerminalProgram";
import { usePreferences } from "./store";
export function Palette({
  onCommand,
}: {
  onCommand: (command: string) => void;
}) {
  const { nodes, open } = useActions();
  const toggle = usePreferences((s) => s.toggle);
  const [q, setQ] = useState("");
  function search(query = q) {
    open({ route: query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search", cwd: "/" });
    toggle("paletteOpen", false);
  }
  const matches = nodes
    .filter((n) =>
      `${n.title} ${n.path} ${n.summary}`
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .slice(0, 5);
  const actions = commands
    .filter((c) =>
      `${c.name} ${c.description}`.toLowerCase().includes(q.toLowerCase()),
    )
    .slice(0, 3);
  return (
    <TerminalProgram
      label="SEARCH / 快速访问"
      onClose={() => toggle("paletteOpen", false)}
      help="输入关键词后 Enter 全文搜索 · search 关键词 · :q 返回"
      onCommand={command => {
        if (command === "search" || command.startsWith("search ")) { search(command.slice(6).trim()); return "正在搜索…"; }
        return "输入 search 关键词进行全文搜索，或 :q 返回。";
      }}
    >
      <label className="sr-only" htmlFor="palette-query">
        搜索页面或操作
      </label>
      <input
        id="palette-query"
        className="palette-input"
        placeholder="前往页面，或查找操作…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); search(); } }}
        data-autofocus
      />
      <div className="palette-results">
        <button
          onClick={() => search()}
        >
          <span>⌕ {q.trim() ? `全文搜索 “${q.trim()}”` : "打开全文搜索"}</span>
          <small>SEARCH ↗</small>
        </button>
        <p className="eyebrow">页面与公开内容</p>
        {matches.map((n) => (
          <button
            key={n.id}
            onClick={() => {
              open(navigationFor(n));
              toggle("paletteOpen", false);
            }}
          >
            <span>
              {n.kind === "directory" ? "▱" : "↳"} {n.title}
            </span>
            <small>{n.path === "/" ? "~" : n.path}</small>
          </button>
        ))}
        <p className="eyebrow">命令</p>
        {actions.map((c) => (
          <button
            key={c.name}
            onClick={() => {
              onCommand(c.usage ? `help ${c.name}` : c.name);
              toggle("paletteOpen", false);
            }}
          >
            <span>{c.name}</span>
            <small>{c.description}</small>
          </button>
        ))}
        {!matches.length && !actions.length && (
          <p>没有匹配的公开内容或操作。</p>
        )}
      </div>
    </TerminalProgram>
  );
}
