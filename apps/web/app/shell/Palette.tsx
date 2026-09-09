import { useState } from "react";
import { commands, navigationFor } from "@hadesd/terminal-core";
import { useActions } from "./actions";
import { Modal } from "./Modal";
import { usePreferences } from "./store";
export function Palette({
  onCommand,
}: {
  onCommand: (command: string) => void;
}) {
  const { nodes, open } = useActions();
  const toggle = usePreferences((s) => s.toggle);
  const [q, setQ] = useState("");
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
    <Modal
      label="COMMAND PALETTE / 快速访问"
      onClose={() => toggle("paletteOpen", false)}
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
        data-autofocus
      />
      <div className="palette-results">
        <button
          onClick={() => {
            open({
              route: q.trim()
                ? `/search?q=${encodeURIComponent(q.trim())}`
                : "/search",
              cwd: "/",
            });
            toggle("paletteOpen", false);
          }}
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
    </Modal>
  );
}
