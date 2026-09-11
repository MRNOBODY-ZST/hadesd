import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import "./terminal-program.css";

export function TerminalProgram({ label, onClose, children, help, onCommand }: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  help?: string;
  onCommand?: (command: string) => string | void | Promise<string | void>;
}) {
  const region = useRef<HTMLElement>(null), commandInput = useRef<HTMLInputElement>(null);
  const programId = useId();
  const [command, setCommand] = useState(""), [message, setMessage] = useState(""), [running, setRunning] = useState(false);
  useEffect(() => {
    const active = document.activeElement;
    (region.current?.querySelector<HTMLElement>("[data-autofocus]") || region.current)?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => region.current?.dispatchEvent(new CustomEvent("hadesd:page", { bubbles: true, detail: { anchor: programId } })));
    return () => { cancelAnimationFrame(frame); if (active instanceof HTMLElement && active.isConnected && !active.closest("[hidden]")) active.focus({ preventScroll: true }); };
  }, [programId]);
  async function execute() {
    const value = command.trim();
    if (!value || running) return;
    setCommand("");
    if ([":q", "q", "quit", "exit"].includes(value)) { onClose(); return; }
    if ([":help", "help", "?"].includes(value)) { setMessage(help || ":q / Esc / Ctrl+C 返回终端。"); return; }
    setRunning(true);
    try { setMessage(await onCommand?.(value) || "未知命令。输入 help 查看可用命令。"); }
    catch { setMessage("操作未完成，请重试。"); }
    finally { setRunning(false); }
  }
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" || (event.ctrlKey && event.key.toLowerCase() === "c")) {
      event.preventDefault(); event.stopPropagation(); onClose(); return;
    }
    if (event.key === ":" && !(event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]"))) {
      event.preventDefault(); event.stopPropagation(); setCommand(":"); commandInput.current?.focus();
    }
  }
  return <section id={programId} ref={region} tabIndex={-1} aria-label={label} className="terminal-program" data-terminal-program="true" onKeyDown={keys}>
    <header className="terminal-program-heading"><span>{label}</span><button type="button" onClick={onClose} aria-label="关闭">:q 返回</button></header>
    <div className="terminal-program-body">{children}</div>
    <footer className="terminal-program-footer">
      <p>{help || "Tab 切换字段 · Enter 提交 · :q / Esc / Ctrl+C 返回"}</p>
      {message && <p role="status">{message}</p>}
      <div className="terminal-program-command"><span aria-hidden="true">:</span><input ref={commandInput} aria-label="程序命令" autoComplete="off" spellCheck={false} value={command} placeholder="help / :q" disabled={running} onChange={event => setCommand(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); event.stopPropagation(); void execute(); }
      }} /><button type="button" disabled={running} onClick={() => void execute()}>执行</button></div>
    </footer>
  </section>;
}
