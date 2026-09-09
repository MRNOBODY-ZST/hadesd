import type {
  Content,
  ContentType,
  Media,
  Page,
  Problem,
  PublishJob,
  PublishRequest,
  Release,
  ReleaseInfo,
  Revision,
  RevisionInput,
  SiteSettings,
  UserAccount,
  BlogComment,
} from "@hadesd/contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public problem: Partial<Problem>,
  ) {
    super(problem.detail || problem.title || `请求失败（${status}）`);
    this.name = "ApiError";
  }
}
interface Csrf {
  token: string;
  headerName: string;
}
let csrf: Csrf | undefined;
let csrfRequest: Promise<Csrf> | undefined;
export async function refreshCsrf(): Promise<Csrf> {
  csrf = undefined;
  if (!csrfRequest)
    csrfRequest = fetch("/api/v1/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    })
      .then(async (r) => {
        if (!r.ok) throw await errorFrom(r);
        const token = (await r.json()) as Csrf;
        csrf = token;
        return token;
      })
      .finally(() => {
        csrfRequest = undefined;
      });
  return csrfRequest;
}
async function errorFrom(response: Response): Promise<ApiError> {
  let problem: Partial<Problem> = {};
  try {
    problem = (await response.json()) as Partial<Problem>;
  } catch {
    /* No body on some auth responses. */
  }
  return new ApiError(response.status, problem);
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = options.method || "GET";
  const headers = new Headers(options.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrf || (await refreshCsrf());
    headers.set(token.headerName, token.token);
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (failure) {
    throw new Error(
      failure instanceof DOMException && failure.name === "TimeoutError"
        ? "服务器响应超时，请稍后重试。"
        : "无法连接服务器，请检查网络后重试。",
    );
  }
  if (!response.ok) {
    if (response.status === 403) csrf = undefined;
    if (
      response.status === 401 &&
      path !== "/auth/login" &&
      path !== "/auth/me"
    )
      window.dispatchEvent(new Event("hadesd:session-expired"));
    throw await errorFrom(response);
  }
  if (response.status === 204) return undefined as T;
  const raw = await response.text();
  return (raw ? JSON.parse(raw) : undefined) as T;
}
const json = (method: string, value: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(value),
});
const id = encodeURIComponent;
export const api = {
  me: () => request<UserAccount>("/auth/me"),
  login: async (username: string, password: string) => {
    await refreshCsrf();
    await request<void>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, password }),
    });
    await refreshCsrf();
    return api.me();
  },
  logout: async () => {
    await request<void>("/auth/logout", { method: "POST" });
    await refreshCsrf();
  },
  contents: (page = 0) =>
    request<Page<Content>>(`/admin/contents?page=${page}&size=20`),
  content: (contentId: string) =>
    request<Content>(`/admin/contents/${id(contentId)}`),
  create: (type: ContentType, revision: RevisionInput) =>
    request<Content>("/admin/contents", json("POST", { type, ...revision })),
  save: (contentId: string, version: number, revision: RevisionInput) =>
    request<Content>(
      `/admin/contents/${id(contentId)}/revisions`,
      json("POST", { version, ...revision }),
    ),
  revisions: (contentId: string, page = 0) =>
    request<Page<Revision>>(
      `/admin/contents/${id(contentId)}/revisions?page=${page}&size=20`,
    ),
  revision: (contentId: string, revisionId: string) =>
    request<Revision>(
      `/admin/contents/${id(contentId)}/revisions/${id(revisionId)}`,
    ),
  media: (page = 0) =>
    request<Page<Media>>(`/admin/media?page=${page}&size=20`),
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Media>("/admin/media", { method: "POST", body: form });
  },
  deleteMedia: (mediaId: string) =>
    request<void>(`/admin/media/${id(mediaId)}`, { method: "DELETE" }),
  settings: () => request<SiteSettings>("/admin/settings"),
  saveSettings: (settings: SiteSettings) =>
    request<SiteSettings>("/admin/settings", json("PUT", settings)),
  publish: (value: PublishRequest) =>
    request<PublishJob>("/admin/publish-jobs", json("POST", value)),
  job: (jobId: string) =>
    request<PublishJob>(`/admin/publish-jobs/${id(jobId)}`),
  releases: (page = 0) =>
    request<Page<Release>>(`/admin/releases?page=${page}&size=20`),
  rollback: (releaseId: string) =>
    request<PublishJob>(`/admin/releases/${id(releaseId)}/rollback-jobs`, {
      method: "POST",
    }),
  release: () => request<ReleaseInfo>("/public/release"),
  comments: (page = 0, contentId?: string) => request<Page<BlogComment>>(`/admin/comments?page=${page}&size=20${contentId ? `&contentId=${id(contentId)}` : ""}`),
  deleteComment: (commentId: string) => request<void>(`/admin/comments/${id(commentId)}`, { method: "DELETE" }),
};
export const privateMediaUrl = (mediaId: string) =>
  `/api/v1/admin/media/${encodeURIComponent(mediaId)}/content`;
export const publicMediaUrl = (mediaId: string) =>
  `/api/v1/public/media/${encodeURIComponent(mediaId)}`;
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。";
