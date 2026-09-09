// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const response = (value: unknown, status = 200) =>
  new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
describe("session and CSRF request contract", () => {
  it("uses form login, refreshes CSRF after login and logout, and preserves multipart boundaries", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        response({ token: "before-login", headerName: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(response(undefined))
      .mockResolvedValueOnce(
        response({ token: "after-login", headerName: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(response({ username: "hades" }))
      .mockResolvedValueOnce(response(undefined, 204))
      .mockResolvedValueOnce(
        response({ token: "after-logout", headerName: "X-CSRF-TOKEN" }),
      )
      .mockResolvedValueOnce(response({ id: "media-1" }));
    vi.stubGlobal("fetch", fetcher);
    const { api } = await import("./api");
    await api.login("hades", "unit-test-password");
    const login = fetcher.mock.calls[1] as [string, RequestInit];
    expect(login[0]).toBe("/api/v1/auth/login");
    expect(new Headers(login[1].headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(new Headers(login[1].headers).get("X-CSRF-TOKEN")).toBe(
      "before-login",
    );
    expect((login[1].body as URLSearchParams).get("username")).toBe("hades");
    expect(login[1].credentials).toBe("same-origin");
    await api.logout();
    expect(
      new Headers(
        (fetcher.mock.calls[4] as [string, RequestInit])[1].headers,
      ).get("X-CSRF-TOKEN"),
    ).toBe("after-login");
    await api.upload(new File(["image"], "test.png", { type: "image/png" }));
    const upload = fetcher.mock.calls[6] as [string, RequestInit];
    expect(new Headers(upload[1].headers).get("X-CSRF-TOKEN")).toBe(
      "after-logout",
    );
    expect(new Headers(upload[1].headers).has("Content-Type")).toBe(false);
    expect(upload[1].body).toBeInstanceOf(FormData);
  });
  it("preserves Problem Details and signals session expiry without retrying unsafe writes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ token: "csrf", headerName: "X-CSRF" }))
      .mockResolvedValueOnce(
        response(
          { status: 401, code: "UNAUTHENTICATED", detail: "登录已过期" },
          401,
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const expired = vi.fn();
    window.addEventListener("hadesd:session-expired", expired);
    const { request, ApiError } = await import("./api");
    await expect(
      request("/admin/settings", { method: "PUT", body: "{}" }),
    ).rejects.toMatchObject({ status: 401, message: "登录已过期" });
    expect(ApiError.prototype).toBeInstanceOf(Error);
    expect(expired).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    window.removeEventListener("hadesd:session-expired", expired);
  });
  it("does not expose an HTTP success when the backend returns a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response(
            {
              code: "DATABASE_UNAVAILABLE",
              detail: "服务暂不可用",
              requestId: "trace-1",
            },
            503,
          ),
        ),
    );
    const { api } = await import("./api");
    await expect(api.contents()).rejects.toMatchObject({
      status: 503,
      problem: { requestId: "trace-1" },
    });
  });
});
