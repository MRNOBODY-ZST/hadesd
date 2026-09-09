import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import {
  dateTime,
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
} from "../components/Shared";
import { usePublish } from "./Publishing";
import styles from "../styles.module.css";
export default function Releases() {
  const [page, setPage] = useState(0);
  const releases = useQuery({
    queryKey: ["releases", page],
    queryFn: () => api.releases(page),
  });
  const current = useQuery({ queryKey: ["release"], queryFn: api.release });
  const publish = usePublish();
  return (
    <>
      <PageHeading
        eyebrow="A HISTORY OF WHAT WENT LIVE"
        title="发布记录"
        description="每次上线都有迹可循。好好写作，安心回望。"
        action={
          <button
            className={styles.primary}
            disabled={publish.isPending || current.isPending || current.isError}
            onClick={() => {
              if (
                window.confirm(
                  current.data?.state === "EMPTY"
                    ? "创建第一个公开站点版本？它将包含当前站点设置。"
                    : "重新构建当前公开内容与已保存站点设置？私有草稿不会被自动发布。",
                )
              )
                publish.mutate({
                  operation:
                    current.data?.state === "EMPTY" ? "INITIALIZE" : "SETTINGS",
                });
            }}
          >
            {current.data?.state === "EMPTY"
              ? "初始化公开站点"
              : "发布站点设置"}
          </button>
        }
      />
      {publish.error && <ErrorNotice error={publish.error} />}
      <section className={styles.releaseCurrent}>
        <div className={styles.releaseIndicator} />
        <div>
          <p className={styles.eyebrow}>CURRENT RELEASE</p>
          <h2>
            {current.isPending
              ? "正在读取线上版本…"
              : current.isError
                ? "当前版本暂不可用"
                : current.data?.state === "ACTIVE"
                  ? current.data.releaseId?.slice(0, 12)
                  : "尚未上线"}
          </h2>
          <p>
            {current.data?.createdAt
              ? `${dateTime(current.data.createdAt)} 上线`
              : "初始化后，空站点也能被完整阅读。"}
          </p>
        </div>
        <a href="/" target="_blank" rel="noreferrer">
          打开公开站点 ↗
        </a>
      </section>
      {current.error && (
        <ErrorNotice
          error={current.error}
          retry={() => void current.refetch()}
        />
      )}
      {releases.isPending ? (
        <Loading />
      ) : releases.error ? (
        <ErrorNotice
          error={releases.error}
          retry={() => void releases.refetch()}
        />
      ) : !releases.data.items.length ? (
        <Empty title="第一份发布记录，在下一步">
          初始化公开站点，或前往编辑器发布一份已保存的修订。
        </Empty>
      ) : (
        <div className={styles.releaseList}>
          {releases.data.items.map((release) => (
            <article className={styles.releaseRow} key={release.id}>
              <span className={styles.releaseMarker} />
              <div>
                <h2>
                  <code>{release.id.slice(0, 12)}</code>
                  {release.id === current.data?.releaseId && (
                    <span className={styles.onlineBadge}>当前在线</span>
                  )}
                </h2>
                <p>
                  <time dateTime={release.createdAt}>
                    {dateTime(release.createdAt)}
                  </time>{" "}
                  · {release.status}
                </p>
              </div>
              <button
                disabled={
                  publish.isPending ||
                  release.id === current.data?.releaseId ||
                  !["SUCCEEDED", "ACTIVE", "DEPLOYED"].includes(release.status)
                }
                onClick={() => {
                  if (
                    window.confirm(
                      `将公开站点回滚到版本 ${release.id.slice(0, 12)}？此操作会创建新的发布任务。`,
                    )
                  )
                    publish.mutate({
                      operation: "ROLLBACK",
                      releaseId: release.id,
                    });
                }}
              >
                回滚至此版本 ↶
              </button>
            </article>
          ))}
        </div>
      )}
      {releases.data && (
        <Pagination
          page={page}
          total={releases.data.total}
          size={20}
          onChange={setPage}
        />
      )}
      <div className={styles.pageNote}>
        <span>↗</span> 构建完成并切换成功后，站点才会更新。失败会保留原有版本。
      </div>
    </>
  );
}
