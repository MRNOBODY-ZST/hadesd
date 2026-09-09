import { afterEach, beforeEach, expect, it, vi } from "vitest";

let api: typeof import("./api");
const user = { id: "reader-1", username: "qa_reader", displayName: "读者", role: "USER" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(async () => { vi.resetModules(); api = await import("./api"); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses a fresh post-login CSRF token for the first authenticated comment", async () => {
  let token = 0;
  const fetch = vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/auth/csrf")) return json({ headerName: "X-CSRF-TOKEN", token: `token-${++token}` });
    if (path.endsWith("/auth/login")) {
      expect(new Headers(options?.headers).get("X-CSRF-TOKEN")).toBe("token-1");
      expect((options?.body as URLSearchParams).get("username")).toBe("qa_reader");
      expect(options?.credentials).toBe("same-origin");
      return new Response("", { status: 200 });
    }
    if (path.endsWith("/auth/me")) return json(user);
    if (path.endsWith("/contents/article/comments")) {
      expect(new Headers(options?.headers).get("X-CSRF-TOKEN")).toBe("token-2");
      return json({ id: "comment-1", body: "会话后的第一条评论" }, 201);
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetch);
  expect(await api.community.login("qa_reader", "test-only-password")).toEqual(user);
  expect(await api.community.addComment("article", { body: "会话后的第一条评论", attachmentIds: [] })).toMatchObject({ id: "comment-1" });
  expect(token).toBe(2);
});

it("does not retry rejected mutations automatically and refreshes CSRF on explicit retry", async () => {
  let tokens = 0, mutations = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    if (path.endsWith("/auth/csrf")) return json({ headerName: "X-CSRF-TOKEN", token: `token-${++tokens}` });
    mutations++;
    if (mutations === 1) return json({ code: "CSRF_INVALID", detail: "请刷新令牌" }, 403);
    expect(new Headers(options?.headers).get("X-CSRF-TOKEN")).toBe("token-2");
    return json({ id: "comment-1" }, 201);
  }));
  const draft = { body: "保留我的草稿", attachmentIds: [] };
  await expect(api.community.addComment("article", draft)).rejects.toMatchObject({ status: 403, code: "CSRF_INVALID", message: "请刷新令牌" });
  expect(mutations).toBe(1);
  expect(draft.body).toBe("保留我的草稿");
  await expect(api.community.addComment("article", draft)).resolves.toMatchObject({ id: "comment-1" });
  expect(mutations).toBe(2);
  expect(tokens).toBe(2);
});

it("notifies account expiry while preserving a typed API error for the caller", async () => {
  const expired = vi.fn();
  window.addEventListener("hadesd:account-expired", expired);
  vi.stubGlobal("fetch", vi.fn(async () => json({ code: "UNAUTHENTICATED", detail: "请先登录" }, 401)));
  try {
    await expect(api.community.files()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED", message: "请先登录" });
    expect(expired).toHaveBeenCalledOnce();
    // A bad password belongs to the sign-in form, rather than expiring other UI state.
    await expect(api.request("/auth/login")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
  } finally { window.removeEventListener("hadesd:account-expired", expired); }
});

it("separates caller cancellation from a failed network connection", async () => {
  const failure = new TypeError("network offline");
  vi.stubGlobal("fetch", vi.fn(async () => { throw failure; }));
  await expect(api.community.files()).rejects.toThrow("连接中断或服务器响应超时，请稍后重试。");
  const controller = new AbortController();
  const canceled = new DOMException("Canceled by caller", "AbortError");
  controller.abort(canceled);
  vi.stubGlobal("fetch", vi.fn(async () => { throw canceled; }));
  await expect(api.community.files(0, controller.signal)).rejects.toBe(canceled);
});

it("finishes an old cookie read before login and queues focus until post-login CSRF and identity complete", async () => {
  const oldRead = deferred<void>(), postLoginCsrf = deferred<void>(), identity = deferred<void>();
  const events: string[] = [];
  let cookie = "old", serverSession = "old", reads = 0, tokens = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    const route = path.replace("/api/v1/auth/", ""); events.push(route);
    if (route === "session") {
      const sentCookie = cookie;
      if (++reads === 1) {
        await oldRead.promise;
        // Model Spring's expired-cookie response when an old ID arrives after rotation.
        if (sentCookie !== serverSession) cookie = "";
        return json({ user: null });
      }
      return json({ user: cookie === "new" ? user : null });
    }
    if (route === "csrf") {
      if (++tokens === 2) await postLoginCsrf.promise;
      return json({ headerName: "X-CSRF-TOKEN", token: `token-${tokens}` });
    }
    if (route === "login") { serverSession = cookie = "new"; return new Response("", { status: 200 }); }
    if (route === "me") { await identity.promise; return json(user); }
    throw new Error(`Unexpected request: ${path}`);
  }));
  const initial = api.community.session();
  await vi.waitFor(() => expect(events).toEqual(["session"]));
  const login = api.community.login("qa_reader", "test-only-password");
  const focused = api.community.session();
  expect(events).toEqual(["session"]);
  oldRead.resolve(); await initial;
  await vi.waitFor(() => expect(events).toEqual(["session", "csrf", "login", "csrf"]));
  expect(cookie).toBe("new");
  postLoginCsrf.resolve();
  await vi.waitFor(() => expect(events).toEqual(["session", "csrf", "login", "csrf", "me"]));
  identity.resolve();
  await expect(login).resolves.toEqual(user);
  await expect(focused).resolves.toEqual({ user });
  expect(cookie).toBe("new");
  expect(events).toEqual(["session", "csrf", "login", "csrf", "me", "session"]);
});

it.each(["logout", "password"] as const)("keeps session reads behind the complete %s operation", async change => {
  const mutation = deferred<Response>(), started = deferred<void>();
  let sessions = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.endsWith("/auth/csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "fixture" });
    if (path.endsWith(change === "logout" ? "/auth/logout" : "/account/password")) { started.resolve(); return mutation.promise; }
    if (path.endsWith("/auth/session")) { sessions++; return json({ user: null }); }
    throw new Error(`Unexpected request: ${path}`);
  }));
  const changed = change === "logout" ? api.community.logout() : api.community.password("old-password", "new-password");
  await started.promise;
  const focused = api.community.session();
  expect(sessions).toBe(0);
  mutation.resolve(new Response(null, { status: 204 }));
  await changed;
  await expect(focused).resolves.toEqual({ user: null });
  expect(sessions).toBe(1);
});

it("recovers the queue after failed reads and rejected login without retrying either request", async () => {
  let reads = 0, logins = 0;
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    if (path.endsWith("/auth/session")) {
      if (++reads === 1) throw new TypeError("offline");
      return json({ user: null });
    }
    if (path.endsWith("/auth/csrf")) return json({ headerName: "X-CSRF-TOKEN", token: "fixture" });
    if (path.endsWith("/auth/login")) { logins++; return json({ code: "INVALID_CREDENTIALS" }, 401); }
    throw new Error(`Unexpected request: ${path}`);
  }));
  const failedRead = expect(api.community.session()).rejects.toThrow("连接中断");
  const failedLogin = expect(api.community.login("qa_reader", "wrong-password")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  const nextRead = api.community.session();
  await Promise.all([failedRead, failedLogin]);
  await expect(nextRead).resolves.toEqual({ user: null });
  expect(reads).toBe(2); expect(logins).toBe(1);
});

it("cancels a queued focus read promptly, never sends it, and preserves the next operation", async () => {
  const firstRead = deferred<Response>(), started = deferred<void>();
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (++reads === 1) { started.resolve(); return firstRead.promise; }
    return json({ user: null });
  }));
  const first = api.community.session(); await started.promise;
  const controller = new AbortController();
  const canceled = new DOMException("Unmounted", "AbortError");
  const queued = expect(api.community.session(controller.signal)).rejects.toBe(canceled);
  const following = api.community.session();
  controller.abort(canceled); await queued;
  expect(reads).toBe(1);
  firstRead.resolve(json({ user: null }));
  await first; await expect(following).resolves.toEqual({ user: null });
  expect(reads).toBe(2);
});

it("propagates cancellation to an active read and waits for it to settle before login", async () => {
  const started = deferred<void>(), finishAbort = deferred<void>();
  const events: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    const route = path.replace("/api/v1/auth/", ""); events.push(route);
    if (route === "session") {
      return new Promise<Response>((resolve, reject) => {
        options!.signal!.addEventListener("abort", () => { void finishAbort.promise.then(() => reject(options!.signal!.reason)); }, { once: true });
        started.resolve();
      });
    }
    if (route === "csrf") return json({ headerName: "X-CSRF-TOKEN", token: "fixture" });
    if (route === "login") return new Response("", { status: 200 });
    if (route === "me") return json(user);
    throw new Error(`Unexpected request: ${path}`);
  }));
  const controller = new AbortController();
  const canceled = new DOMException("Unmounted", "AbortError");
  const reading = expect(api.community.session(controller.signal)).rejects.toBe(canceled);
  await started.promise;
  const login = api.community.login("qa_reader", "test-only-password");
  controller.abort(canceled); await reading;
  expect(events).toEqual(["session"]);
  finishAbort.resolve();
  await expect(login).resolves.toEqual(user);
  expect(events).toEqual(["session", "csrf", "login", "csrf", "me"]);
});
