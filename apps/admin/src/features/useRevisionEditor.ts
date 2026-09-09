import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Content, RevisionInput } from "@hadesd/contracts";
import { api, ApiError } from "../api";
import { useUi } from "../store";
export type SaveStatus = "saved" | "dirty" | "saving" | "conflict" | "error";
export function inputFrom(content: RevisionInput): RevisionInput {
  return {
    title: content.title,
    slug: content.slug,
    summary: content.summary,
    markdown: content.markdown,
    tags: [...content.tags],
    language: content.language,
    coverMediaId: content.coverMediaId || null,
  };
}
export const fingerprint = (revision: RevisionInput) =>
  JSON.stringify(inputFrom(revision));
export function validRevision(input: RevisionInput): boolean {
  return (
    !!input.title.trim() &&
    input.title.length <= 200 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug) &&
    input.slug.length <= 100 &&
    !!input.language.trim() &&
    input.language.length <= 20 &&
    input.summary.length <= 1000 &&
    input.markdown.length <= 2000000 &&
    input.tags.length <= 30 &&
    input.tags.every((tag) => tag.length > 0 && tag.length <= 40)
  );
}
export function useRevisionEditor(initial: Content, pendingAttachments = 0) {
  const client = useQueryClient();
  const pendingAttachmentsRef = useRef(pendingAttachments);
  pendingAttachmentsRef.current = pendingAttachments;
  const [content, setContent] = useState(initial);
  const contentRef = useRef(initial);
  const [draft, setDraft] = useState<RevisionInput>(() =>
    inputFrom(initial.latestRevision),
  );
  const draftRef = useRef(draft);
  const [baseline, setBaseline] = useState(() => fingerprint(draft));
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<unknown>(null);
  const [remote, setRemote] = useState<Content | null>(null);
  const savingRef = useRef(false);
  const saveMutation = useMutation({
    mutationFn: ({
      current,
      value,
    }: {
      current: Content;
      value: RevisionInput;
    }) => api.save(current.id, current.version, value),
  });
  const mutateAsync = saveMutation.mutateAsync;
  const dirty = fingerprint(draft) !== baseline;
  const change = useCallback(
    (next: RevisionInput | ((current: RevisionInput) => RevisionInput)) => {
      const value = typeof next === "function" ? next(draftRef.current) : next;
      draftRef.current = value;
      setDraft(value);
      setStatus((s) => (s === "conflict" || s === "saving" ? s : "dirty"));
      setError(null);
    },
    [],
  );
  const save = useCallback(
    async (
      replacement?: RevisionInput,
      against?: Content,
    ): Promise<Content | undefined> => {
      if (savingRef.current || pendingAttachmentsRef.current > 0) return;
      const value = inputFrom(replacement || draftRef.current);
      if (!validRevision(value)) {
        setError(
          new Error(
            "请检查标题、链接、语言及标签（最多 30 个，每个不超过 40 字）。",
          ),
        );
        setStatus("error");
        return;
      }
      savingRef.current = true;
      setStatus("saving");
      setError(null);
      try {
        const next = await mutateAsync({
          current: against || contentRef.current,
          value,
        });
        contentRef.current = next;
        setContent(next);
        setBaseline(fingerprint(value));
        setRemote(null);
        if (replacement) {
          draftRef.current = value;
          setDraft(value);
        }
        setStatus(
          fingerprint(draftRef.current) === fingerprint(value)
            ? "saved"
            : "dirty",
        );
        client.setQueryData(["content", next.id], next);
        void client.invalidateQueries({ queryKey: ["contents"] });
        void client.invalidateQueries({ queryKey: ["revisions", next.id] });
        return next;
      } catch (failure) {
        setError(failure);
        if (
          failure instanceof ApiError &&
          failure.status === 409 &&
          [
            "REVISION_CONFLICT",
            "VERSION_CONFLICT",
            "OPTIMISTIC_LOCK",
            "CONFLICT",
          ].includes(failure.problem.code || "CONFLICT")
        ) {
          setStatus("conflict");
          try {
            setRemote(await api.content(initial.id));
          } catch {
            /* Keep local text even if conflict comparison cannot be loaded. */
          }
        } else setStatus("error");
        return undefined;
      } finally {
        savingRef.current = false;
      }
    },
    [mutateAsync, client, initial.id],
  );
  useEffect(() => {
    if (pendingAttachments > 0 || !dirty || status !== "dirty" || !validRevision(draft)) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, status, save, pendingAttachments]);
  useEffect(() => {
    if (!dirty && status === "dirty") setStatus("saved");
    useUi.getState().setDirty(dirty || pendingAttachments > 0, status === "saving");
  }, [dirty, status, pendingAttachments]);
  useEffect(() => () => useUi.getState().setDirty(false), []);
  const loadRemote = () => {
    if (
      !remote ||
      !window.confirm("确定载入服务器版本？当前未保存的文字将被替换。")
    )
      return false;
    const value = inputFrom(remote.latestRevision);
    contentRef.current = remote;
    setContent(remote);
    draftRef.current = value;
    setDraft(value);
    setBaseline(fingerprint(value));
    setStatus("saved");
    setError(null);
    setRemote(null);
    return true;
  };
  const mergeAsRevision = () => remote && save(undefined, remote);
  return {
    content,
    draft,
    change,
    dirty,
    status,
    error,
    remote,
    save,
    loadRemote,
    mergeAsRevision,
  };
}
