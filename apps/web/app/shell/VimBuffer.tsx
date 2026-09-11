import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BlogDraft } from "./blogEditor";
import "./VimBuffer.css";

export function VimBuffer({ path, markdown, loadDraft, identity, onClose }: {
  path: string;
  markdown: string;
  loadDraft?: (signal: AbortSignal) => Promise<BlogDraft>;
  identity?: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"NORMAL" | "INSERT" | "COMMAND">("NORMAL");
  const [command, setCommand] = useState("");
  const [text, setText] = useState(markdown);
  const [savedText, setSavedText] = useState(markdown);
  const [scope, setScope] = useState<"public" | "local" | "server">("public");
  const [message, setMessage] = useState("i 编辑 · h j k l / 方向键移动 · PgUp/PgDn 翻页 · :q 退出");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState({ row: 0, column: 0 });
  const [size, setSize] = useState({ rows: 18, columns: 90 });
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const commandField = useRef<HTMLInputElement>(null);
  const draft = useRef<BlogDraft | null>(null);
  const draftOwner = useRef<string | undefined>(undefined);
  const operation = useRef<AbortController | null>(null);
  const composing = useRef(false);
  const prefix = useRef("");
  const caret = useRef(0);
  const lines = text.split("\n");
  const dirty = text !== savedText;
  const locked = scope === "server" && draftOwner.current !== identity;
  const top = Math.floor(cursor.row / size.rows) * size.rows;
  const left = Math.max(0, cursor.column - size.columns + 1);
  const storageKey = "hadesd.vim.local.v1:" + path;
  useLayoutEffect(() => {
    const control = mode === "COMMAND" ? commandField.current : mode === "INSERT" ? editor.current : root.current;
    control?.focus({ preventScroll: true });
    if (mode === "INSERT") editor.current?.setSelectionRange(caret.current, caret.current);
  }, [mode]);
  useEffect(() => {
    const frame = viewport.current;
    if (!frame) return;
    const measure = () => {
      const style = getComputedStyle(frame);
      const line = parseFloat(style.lineHeight) || 22;
      setSize({ rows: Math.max(1, Math.floor((frame.clientHeight || 396) / line)), columns: Math.max(10, Math.floor(((frame.clientWidth || 780) - 55) / 8)) });
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => () => { operation.current?.abort(); }, []);
  useEffect(() => {
    if (locked) {
      operation.current?.abort(); operation.current = null;
      setBusy(false); setMode("NORMAL"); setCommand("");
      composing.current = false;
    }
  }, [locked]);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, [dirty]);
  function move(row: number, column = cursor.column) {
    const nextRow = Math.max(0, Math.min(row, lines.length - 1));
    setCursor({ row: nextRow, column: Math.max(0, Math.min(column, Math.max(0, lines[nextRow]!.length - 1))) });
  }
  async function enterInsert(append = false) {
    if (busy || locked) return;
    let value = text;
    if (scope === "public") {
      if (loadDraft) {
        const controller = new AbortController(); operation.current = controller;
        setBusy(true); setMessage("正在读取服务器最新草稿…");
        try {
          const loaded = await loadDraft(controller.signal);
          if (controller.signal.aborted) return;
          draft.current = loaded; draftOwner.current = identity; value = loaded.markdown;
          setScope("server");
        } catch (error) {
          if (!controller.signal.aborted) setMessage(`E484: ${(error as Error).message || "无法读取服务器草稿"}`);
          return;
        } finally { if (!controller.signal.aborted) { setBusy(false); operation.current = null; } }
      } else {
        try {
          const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
          if (stored && typeof stored === "object" && "markdown" in stored && typeof stored.markdown === "string") value = stored.markdown;
        } catch { /* Start a local copy even if browser storage cannot be read. */ }
        setScope("local");
      }
      setText(value); setSavedText(value);
    }
    const sourceLines = value.split("\n");
    const row = Math.min(cursor.row, sourceLines.length - 1);
    caret.current = sourceLines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0) + Math.min(cursor.column + Number(append), sourceLines[row]!.length);
    setMessage(loadDraft ? "编辑服务器草稿；:w 保存草稿，发布请使用写作台。" : "编辑浏览器本地副本；:w 仅保存到此浏览器，公开文章保持原样。");
    setMode("INSERT");
  }
  async function ex(raw: string) {
    if (busy) return;
    const value = raw.trim().replace(/^:/u, "");
    setCommand(""); setMode("NORMAL");
    if (value === "q!" || (value === "q" && !dirty)) { onClose(); return; }
    if (value === "q") { setMessage("E37: 尚有未保存修改。使用 :w 保存，或 :q! 放弃修改。"); return; }
    if (locked) { setMessage("私人草稿已锁定。请使用原管理员账号重新登录后保存；:q! 放弃修改并退出。"); return; }
    if (!["w", "wq", "x"].includes(value)) { setMessage(`E492: 未知命令 ${value}。支持 :w :wq :q :q!`); return; }
    if (value === "x" && !dirty) { onClose(); return; }
    if (scope === "public") { setMessage("E45: 公开文件为只读。按 i 进入可编辑草稿，再使用 :w。"); return; }
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setMessage(scope === "server" ? "正在保存服务器草稿…" : "正在保存浏览器副本…");
    try {
      if (scope === "server") await draft.current!.save(text, controller.signal);
      else localStorage.setItem(storageKey, JSON.stringify({ markdown: text, savedAt: new Date().toISOString() }));
      if (controller.signal.aborted) return;
      setSavedText(text);
      setMessage(scope === "server" ? "已保存服务器草稿；公开版本将在发布后更新。" : "已保存到此浏览器的本地副本；公开文章保持原样。");
      if (value === "wq" || value === "x") onClose();
    } catch (error) {
      if (!controller.signal.aborted) setMessage(`E212: ${(error as Error).message || "保存失败"}。修改仍保留，请重试。`);
    } finally { if (!controller.signal.aborted) { setBusy(false); operation.current = null; } }
  }
  function keyDown(event: KeyboardEvent) {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.stopPropagation();
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      if (mode === "INSERT" && editor.current?.selectionStart !== editor.current?.selectionEnd) return;
      event.preventDefault(); operation.current?.abort(); operation.current = null;
      setBusy(false); setMode("NORMAL"); setMessage(busy ? "操作已中断；修改仍保留。服务器写入若已送出，请核对草稿后重试。" : "NORMAL · :q 退出"); return;
    }
    if (busy) { if (event.key !== "Tab") event.preventDefault(); return; }
    if (mode === "COMMAND") {
      if (event.key === "Enter") { event.preventDefault(); void ex(command); }
      else if (event.key === "Escape") { event.preventDefault(); setMode("NORMAL"); setCommand(""); }
      return;
    }
    if (mode === "INSERT") {
      if (event.key === "Escape") {
        event.preventDefault(); const offset = editor.current?.selectionStart ?? 0;
        const before = text.slice(0, offset).split("\n");
        setCursor({ row: before.length - 1, column: Math.max(0, before.at(-1)!.length - 1) });
        setMode("NORMAL");
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target instanceof Element && event.target.closest("button"))) return;
    if (locked && event.key !== ":") return;
    if ([":", "i", "a", "h", "j", "k", "l", "g", "G", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End", "Escape", " "].includes(event.key)) event.preventDefault();
    if (event.key === ":") { setCommand(""); setMode("COMMAND"); }
    else if (event.key === "i" || event.key === "a") void enterInsert(event.key === "a");
    else if (["j", "ArrowDown"].includes(event.key)) move(cursor.row + 1);
    else if (["k", "ArrowUp"].includes(event.key)) move(cursor.row - 1);
    else if (["h", "ArrowLeft"].includes(event.key)) move(cursor.row, cursor.column - 1);
    else if (["l", "ArrowRight"].includes(event.key)) move(cursor.row, cursor.column + 1);
    else if (event.key === "PageDown" || event.key === " ") move(cursor.row + size.rows);
    else if (event.key === "PageUp") move(cursor.row - size.rows);
    else if (event.key === "Home") move(cursor.row, 0);
    else if (event.key === "End") move(cursor.row, lines[cursor.row]!.length - 1);
    else if (event.key === "G") move(lines.length - 1);
    else if (event.key === "g" && prefix.current === "g") move(0, 0);
    prefix.current = event.key === "g" && prefix.current !== "g" ? "g" : "";
  }
  return <section className="vim-buffer" data-terminal-program="vim" data-vim-mode={mode} aria-label="Vim 编辑器" tabIndex={0} ref={root} onKeyDown={keyDown}>
    <header className="vim-header"><span>VIM · {path}{dirty ? " [+]" : ""}</span><span>{locked ? "LOCKED" : scope === "public" ? "READ ONLY" : scope === "server" ? "SERVER DRAFT" : "LOCAL COPY"}</span></header>
    <div className="vim-viewport" ref={viewport}>
      {locked ? <p>PRIVATE DRAFT LOCKED · 私人草稿已隐藏，未保存修改仍保留。</p> : mode === "INSERT" ? <textarea ref={editor} className="vim-insert" aria-label="Vim 文本" value={text} spellCheck={false} autoCapitalize="off" autoComplete="off" onChange={event => setText(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /> :
        <pre className="vim-lines" aria-label="文件源码">{lines.slice(top, top + size.rows).map((line, index) => <span className="vim-line" key={top + index} data-vim-line={top + index + 1}><span className="vim-line-number" aria-hidden="true">{top + index + 1}</span><span>{top + index === cursor.row ? <>{line.slice(left, cursor.column)}<mark className="vim-cursor">{line[cursor.column] || " "}</mark>{line.slice(cursor.column + 1, left + size.columns)}</> : line.slice(left, left + size.columns) || " "}</span></span>)}</pre>}
    </div>
    <div className="vim-status"><strong>-- {mode} --</strong>{!locked && <span>{cursor.row + 1},{cursor.column + 1} · {lines.length} LINES</span>}</div>
    <div className="vim-message" role="status">{locked ? "私人草稿已锁定。请使用原管理员账号重新登录以继续编辑，或 :q! 放弃修改并退出。" : message}</div>
    {mode === "COMMAND" && <form className="vim-command" onSubmit={event => { event.preventDefault(); if (!composing.current) void ex(command); }}><label htmlFor="vim-command">:</label><input id="vim-command" aria-label="Vim 命令" ref={commandField} value={command} autoComplete="off" autoCapitalize="off" onChange={event => setCommand(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /><button type="submit">[ ↵ ]</button></form>}
    <nav className="vim-actions" aria-label="Vim 操作"><button disabled={busy || locked} onClick={() => void enterInsert()}>[ i 编辑 ]</button><button disabled={busy || locked} onClick={() => void ex("w")}>[ :w 保存 ]</button><button disabled={busy} onClick={() => { setCommand(""); setMode("COMMAND"); }}>[ : 命令 ]</button><button disabled={busy} onClick={() => void ex("q")}>[ :q 退出 ]</button><button disabled={locked} onClick={() => move(cursor.row - size.rows)} aria-label="Vim 上一屏">[ ↑ ]</button><button disabled={locked} onClick={() => move(cursor.row + size.rows)} aria-label="Vim 下一屏">[ ↓ ]</button></nav>
  </section>;
}
