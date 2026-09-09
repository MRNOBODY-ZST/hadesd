import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublishJob, PublishRequest } from "@hadesd/contracts";
import { api } from "../api";
import { useUi } from "../store";
import { ErrorNotice } from "../components/Shared";
import styles from "../styles.module.css";
export const jobLabels: Record<PublishJob["status"], string> = {
  QUEUED: "等待构建",
  BUILDING: "正在构建",
  READY: "构建就绪",
  DEPLOYING: "正在切换版本",
  SUCCEEDED: "已上线",
  FAILED: "发布失败",
};
export const activeJob = (job?: PublishJob) =>
  !!job && !["SUCCEEDED", "FAILED"].includes(job.status);
export function usePublish() {
  const track = useUi((s) => s.trackJob);
  return useMutation({
    mutationFn: (request: PublishRequest) =>
      request.operation === "ROLLBACK" && request.releaseId
        ? api.rollback(request.releaseId)
        : api.publish(request),
    onSuccess: (job, request) => track(job.id, request),
  });
}
export function JobStatus() {
  const tracked = useUi((s) => s.job);
  const client = useQueryClient();
  const [dismissed, setDismissed] = useState("");
  const publish = usePublish();
  const query = useQuery({
    queryKey: ["job", tracked?.id],
    queryFn: () => api.job(tracked!.id),
    enabled: !!tracked,
    refetchInterval: (q) =>
      q.state.error
        ? false
        : activeJob(q.state.data) || !q.state.data
          ? 1500
          : false,
  });
  useEffect(() => {
    if (query.data?.status === "SUCCEEDED") {
      void client.invalidateQueries({ queryKey: ["releases"] });
      void client.invalidateQueries({ queryKey: ["release"] });
    }
  }, [query.data?.status, client]);
  if (!tracked || tracked.id === dismissed) return null;
  const job = query.data;
  return (
    <aside
      className={`${styles.jobBanner} ${job?.status === "FAILED" ? styles.jobFailed : ""}`}
      aria-live="polite"
    >
      <div>
        <strong>{job ? jobLabels[job.status] : "正在读取发布任务…"}</strong>
        <span>
          {job
            ? `发布版本 ${job.releaseId.slice(0, 8)} · 尝试 ${job.attempts} 次`
            : `任务 ${tracked.id.slice(0, 8)}`}
        </span>
        {job?.status === "SUCCEEDED" && (
          <a href="/" target="_blank" rel="noreferrer">
            查看站点 ↗
          </a>
        )}
        {job?.error && <p>{job.error}</p>}
        {query.error && (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        )}
        {publish.error && <ErrorNotice error={publish.error} />}
      </div>
      <div className={styles.inlineActions}>
        {job?.status === "FAILED" && tracked.request && (
          <button
            disabled={publish.isPending}
            onClick={() => publish.mutate(tracked.request!)}
          >
            重新提交发布
          </button>
        )}
        {job && !activeJob(job) && (
          <button
            aria-label="收起发布状态"
            onClick={() => setDismissed(tracked.id)}
          >
            ×
          </button>
        )}
      </div>
    </aside>
  );
}
