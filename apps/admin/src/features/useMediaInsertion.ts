import { useEffect, useRef, useState, type RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { escapeMediaLabel, insertAtSelection, mediaMarkdown, validateUpload } from "./mediaInsertion";

type Options = { textarea: RefObject<HTMLTextAreaElement | null>; update: (change: (markdown: string) => string) => void; onPending?: (count: number) => void };
/** Replace only each reserved marker, never an old snapshot of the author's draft. */
export function useMediaInsertion({ textarea, update, onPending }: Options) {
  const client = useQueryClient();
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true), count = useRef(0), raf = useRef(0);
  const updateRef = useRef(update); updateRef.current = update;
  const onPendingRef = useRef(onPending); onPendingRef.current = onPending;
  const reportPending = () => { setPending(count.current); onPendingRef.current?.(count.current); };
  useEffect(() => { active.current = true; return () => { active.current = false; cancelAnimationFrame(raf.current); }; }, []);
  function insert(snippet: string) {
    const area = textarea.current;
    const start = area?.selectionStart, end = area?.selectionEnd;
    let caret = 0;
    updateRef.current(markdown => {
      const result = insertAtSelection(markdown, snippet, start ?? markdown.length, end ?? markdown.length);
      caret = result.caret; return result.markdown;
    });
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => { if (area === textarea.current) { area?.focus(); area?.setSelectionRange(caret, caret); } });
  }
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    if (count.current + files.length > 8) { setError("每次最多同时上传 8 个文件，请等待当前上传结束。"); return; }
    const invalid = files.map(file => { const reason = validateUpload(file); return reason ? `${file.name}：${reason}` : ""; }).filter(Boolean);
    if (invalid.length) { setError(invalid.join("\n")); return; }
    setError(""); setNotice("");
    const tasks = files.map(file => ({ file, marker: `[正在上传：${escapeMediaLabel(file.name)} · ${crypto.randomUUID()}]()` }));
    insert(tasks.map(task => task.marker).join("\n\n"));
    count.current += tasks.length; reportPending();
    let succeeded = 0, inserted = 0;
    // Sequential uploads bound memory/network use and preserve the selected file order.
    for (const { file, marker } of tasks) {
      if (!active.current) break;
      try {
        const media = await api.upload(file);
        if (!active.current) break;
        let retained = false;
        updateRef.current(markdown => { retained = markdown.includes(marker); return markdown.replace(marker, mediaMarkdown(media)); });
        if (retained) inserted++;
        succeeded++;
        void client.invalidateQueries({ queryKey: ["media"] });
      } catch (reason) {
        if (!active.current) break;
        updateRef.current(markdown => markdown.replace(marker, ""));
        setError(current => [current, `${file.name}：${reason instanceof Error ? reason.message : "上传失败，请重新选择文件。"}`].filter(Boolean).join("\n"));
      } finally {
        count.current--;
        if (active.current) reportPending();
      }
    }
    if (active.current && succeeded) setNotice(inserted ? `已上传 ${succeeded} 个文件，插入 ${inserted} 个引用；发布文章后公开。可继续编辑图片说明。` : `已上传 ${succeeded} 个文件；占位已移除，可从媒体资料重新插入。`);
  }
  return { insert, uploadFiles, pending, error, notice };
}
