import type { BlogComment, CommentInput, Media, Page, Problem, UserAccount } from "@hadesd/contracts";

export class CommunityError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type Csrf = { token: string; headerName: string };
let csrf: Csrf | undefined, pendingCsrf: Promise<Csrf> | undefined;
let sessionQueue: Promise<void> = Promise.resolve();
function withSession<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  // A late anonymous response can expire the cookie installed by login. Finish
  // session reads before rotation, and keep new reads behind the entire change.
  const result = sessionQueue.then(() => { signal?.throwIfAborted(); return operation(); });
  sessionQueue = result.then(() => {}, () => {});
  if (!signal) return result;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    // Cancel the caller promptly, but retain the actual operation in the queue
    // until it settles so cancellation cannot let the next login overtake it.
    result.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
async function failure(response: Response) {
  const data = await response.json().catch(() => ({})) as Partial<Problem>;
  return new CommunityError(response.status, data.code || "REQUEST_FAILED", data.detail || data.title || `请求失败（${response.status}）`);
}
export async function refreshCsrf() {
  csrf = undefined;
  if (!pendingCsrf) pendingCsrf = fetch("/api/v1/auth/csrf", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000) })
    .then(async r => { if (!r.ok) throw await failure(r); return csrf = await r.json() as Csrf; })
    .finally(() => { pendingCsrf = undefined; });
  return pendingCsrf;
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers), method = options.method || "GET";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = csrf || await refreshCsrf(); headers.set(token.headerName, token.token);
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...options, headers, credentials: "same-origin", cache: "no-store",
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error("连接中断或服务器响应超时，请稍后重试。");
  }
  if (!response.ok) {
    if (response.status === 403) csrf = undefined;
    if (response.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event("hadesd:account-expired"));
    throw await failure(response);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text(); return text ? JSON.parse(text) as T : undefined as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const id = encodeURIComponent;
export const community = {
  session: (signal?: AbortSignal) => withSession(() => request<{ user: UserAccount | null }>("/auth/session", { signal }), signal),
  register: (value: { username: string; displayName: string; password: string }) => request<UserAccount>("/auth/register", json("POST", value)),
  login: (username: string, password: string) => withSession(async () => {
    await refreshCsrf();
    await request<void>("/auth/login", { method: "POST", body: new URLSearchParams({ username, password }) });
    await refreshCsrf(); return request<UserAccount>("/auth/me");
  }),
  logout: () => withSession(async () => { await request<void>("/auth/logout", { method: "POST" }); csrf = undefined; }),
  profile: (displayName: string) => request<UserAccount>("/account/profile", json("PUT", { displayName })),
  password: (currentPassword: string, newPassword: string) => withSession(async () => { await request<void>("/account/password", json("POST", { currentPassword, newPassword })); csrf = undefined; }),
  comments: (contentId: string, page = 0, signal?: AbortSignal) => request<Page<BlogComment>>(`/public/contents/${id(contentId)}/comments?page=${page}&size=10`, { signal }),
  addComment: (contentId: string, input: CommentInput) => request<BlogComment>(`/public/contents/${id(contentId)}/comments`, json("POST", input)),
  editComment: (commentId: string, input: CommentInput) => request<BlogComment>(`/account/comments/${id(commentId)}`, json("PUT", input)),
  deleteComment: (commentId: string, admin = false) => request<void>(`/${admin ? "admin" : "account"}/comments/${id(commentId)}`, { method: "DELETE" }),
  myComments: (page = 0, signal?: AbortSignal) => request<Page<BlogComment>>(`/account/comments?page=${page}&size=10`, { signal }),
  files: (page = 0, signal?: AbortSignal) => request<Page<Media>>(`/account/files?page=${page}&size=10`, { signal }),
  upload: (file: File) => { const body = new FormData(); body.append("file", file); return request<Media>("/account/files", { method: "POST", body }); },
  deleteFile: (fileId: string) => request<void>(`/account/files/${id(fileId)}`, { method: "DELETE" }),
};
export const fileUrl = (fileId: string, publicFile = false, download = false) =>
  `/api/v1/${publicFile ? `public/comment-files/${id(fileId)}` : `account/files/${id(fileId)}/content`}${download ? "?download=true" : ""}`;
export const errorText = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";
export const fileSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
