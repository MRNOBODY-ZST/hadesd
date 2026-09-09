import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Media } from "@hadesd/contracts";
import { api, privateMediaUrl, publicMediaUrl } from "../api";
import {
  dateTime,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
} from "../components/Shared";
import styles from "../styles.module.css";
import { MEDIA_ACCEPT, validateUpload } from "./mediaInsertion";
export { validateUpload } from "./mediaInsertion";
const sizeLabel = (size: number) =>
  size < 1024 * 1024
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / (1024 * 1024)).toFixed(1)} MB`;
export default function MediaLibrary({
  compact = false,
  onInsert,
  onCover,
}: {
  compact?: boolean;
  onInsert?: (media: Media) => void;
  onCover?: (media: Media) => void;
}) {
  const [page, setPage] = useState(0);
  const [localError, setLocalError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const media = useQuery({
    queryKey: ["media", page],
    queryFn: () => api.media(page),
  });
  const upload = useMutation({
    mutationFn: api.upload,
    onSuccess: (file) => {
      setNotice(`已上传 ${file.filename}，文件保持私有。`);
      setPage(0);
      void client.invalidateQueries({ queryKey: ["media"] });
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteMedia,
    onSuccess: () => {
      setNotice("文件已删除。");
      void client.invalidateQueries({ queryKey: ["media"] });
    },
  });
  function handleFile(file?: File) {
    if (!file) return;
    setNotice("");
    setLocalError(null);
    const validation = validateUpload(file);
    if (validation) setLocalError(new Error(validation));
    else upload.mutate(file);
  }
  async function copy(file: Media) {
    try {
      await navigator.clipboard.writeText(publicMediaUrl(file.id));
      setNotice("已复制公开引用路径；发布引用它的内容后才可公开访问。");
    } catch {
      setLocalError(new Error("浏览器未允许复制，请从文件引用字段手动复制。"));
    }
  }
  return (
    <>
      {!compact && (
        <PageHeading
          eyebrow="AN ARCHIVE OF YOUR MATERIALS"
          title="媒体资料"
          description="收好图像与文档，让它们在文字里找到位置。"
        />
      )}
      <div
        className={`${styles.uploadArea} ${compact ? styles.uploadCompact : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!upload.isPending) handleFile(e.dataTransfer.files[0]);
        }}
      >
        <span aria-hidden="true">↑</span>
        <div>
          <strong>
            {upload.isPending
              ? "正在安全上传…"
              : compact
                ? "添加新的资料"
                : "拖入文件，或从电脑选择"}
          </strong>
          <p>
            PNG / JPEG / WebP ≤ 10 MB
            <br />
            PDF / ZIP ≤ 25 MB · 文本 ≤ 2 MB
          </p>
        </div>
        <button
          disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          选择文件
        </button>
        <input
          ref={input}
          aria-label="上传媒体文件"
          type="file"
          accept={MEDIA_ACCEPT}
          className={styles.srOnly}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {notice && (
        <p className={styles.successNote} role="status">
          {notice}
        </p>
      )}
      {(localError || upload.error || remove.error) && (
        <ErrorNotice error={localError || upload.error || remove.error} />
      )}
      {media.isPending ? (
        <Loading />
      ) : media.error ? (
        <ErrorNotice error={media.error} retry={() => void media.refetch()} />
      ) : !media.data.items.length ? (
        <Empty title="资料架还是空的">
          上传图片、PDF、ZIP 或 UTF-8 文本，编辑文章时可插入正文。
        </Empty>
      ) : (
        <div className={compact ? styles.mediaCompactList : styles.mediaList}>
          {media.data.items.map((file) => (
            <article className={styles.mediaItem} key={file.id}>
              <a
                href={privateMediaUrl(file.id)}
                className={styles.mediaThumb}
                target="_blank"
                rel="noreferrer"
                aria-label={`私有预览 ${file.filename}`}
              >
                {file.mime.startsWith("image/") ? (
                  <img
                    src={privateMediaUrl(file.id)}
                    alt={file.filename}
                    loading="lazy"
                  />
                ) : (
                  <span>
                    {file.mime === "application/pdf" ? "PDF" : file.mime === "application/zip" ? "ZIP" : "TXT"}<span>↗</span>
                  </span>
                )}
              </a>
              <div className={styles.mediaInfo}>
                <h2 title={file.filename}>{file.filename}</h2>
                <p>
                  {sizeLabel(file.size)} · {dateTime(file.createdAt)}
                </p>
                <span className={styles.privateBadge}>私有资料</span>
                {!compact && (
                  <label className={styles.referenceLabel}>
                    公开引用路径
                    <input
                      readOnly
                      aria-label={`${file.filename} 引用路径`}
                      value={publicMediaUrl(file.id)}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
                <div className={styles.mediaActions}>
                  <a href={`${privateMediaUrl(file.id)}?download=true`} download>下载文件</a>
                  {onInsert ? (
                    <button
                      onClick={() => {
                        onInsert(file);
                        setNotice(`已插入 ${file.filename}。`);
                      }}
                    >
                      插入正文
                    </button>
                  ) : (
                    <button onClick={() => void copy(file)}>复制引用</button>
                  )}
                  {onCover && file.mime.startsWith("image/") && (
                    <button onClick={() => onCover(file)}>设为封面</button>
                  )}
                  <button
                    className={styles.dangerLink}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `删除「${file.filename}」？若已被线上或保留版本引用，服务器会拒绝删除。`,
                        )
                      )
                        remove.mutate(file.id);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {media.data && (
        <Pagination
          page={page}
          total={media.data.total}
          size={20}
          onChange={setPage}
        />
      )}
    </>
  );
}
