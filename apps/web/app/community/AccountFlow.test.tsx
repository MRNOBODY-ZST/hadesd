import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UserAccount } from "@hadesd/contracts";
import { AccountProvider, AccountWorkspace, useAccount } from "./Account";

let session: UserAccount | null;
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
function Harness() {
  const account = useAccount();
  return <main aria-label="终端"><p data-testid="identity">{account.user?.displayName || "guest"}</p><button onClick={() => account.open("login")}>启动登录</button><button onClick={() => account.open("register")}>启动注册</button><AccountWorkspace /></main>;
}
beforeEach(() => {
  session = null;
  vi.stubGlobal("fetch", async (path: string, options?: RequestInit) => {
    if (path.endsWith("/auth/session")) return response({ user: session });
    if (path.endsWith("/auth/csrf")) return response({ token: "test", headerName: "X-CSRF-TOKEN" });
    if (path.endsWith("/auth/login")) {
      const form = options?.body as URLSearchParams;
      if (form.get("username") !== "reader" || form.get("password") !== "test-only-password") return response({ detail: "登录失败" });
      session = { id: "reader-1", username: "reader", displayName: "读者", role: "USER" };
      return response({});
    }
    if (path.endsWith("/auth/me")) return response(session);
    if (path.endsWith("/account/profile") && options?.method === "PUT") {
      session = { ...session!, displayName: JSON.parse(options.body as string).displayName };
      return response(session);
    }
    if (path.includes("/account/files")) return response({ items: [{ id: "file-1", filename: "notes.txt", mime: "text/plain", size: 20, createdAt: "2026-09-10T12:00:00Z" }], page: 0, size: 10, total: 1 });
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it("logs in, saves a profile, navigates files by command and exits without recording credentials", async () => {
  render(<AccountProvider><Harness /></AccountProvider>);
  fireEvent.click(screen.getByRole("button", { name: "启动登录" }));
  const terminal = screen.getByRole("main", { name: "终端" });
  const program = await within(terminal).findByRole("region", { name: "账户" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.change(within(program).getByLabelText("用户名"), { target: { value: "reader" } });
  const password = within(program).getByLabelText("密码") as HTMLInputElement;
  expect(password.type).toBe("password");
  fireEvent.change(password, { target: { value: "test-only-password" } });
  await act(async () => fireEvent.click(within(program).getByRole("button", { name: "登录账户" })));
  await waitFor(() => expect(screen.getByTestId("identity").textContent).toBe("读者"));
  fireEvent.change(within(program).getByLabelText("显示名称"), { target: { value: "终端读者" } });
  await act(async () => fireEvent.click(within(program).getByRole("button", { name: "保存资料" })));
  await waitFor(() => expect(screen.getByTestId("identity").textContent).toBe("终端读者"));
  const command = within(program).getByLabelText("程序命令");
  fireEvent.change(command, { target: { value: "files" } });
  await act(async () => fireEvent.keyDown(command, { key: "Enter" }));
  await within(program).findByText("notes.txt");
  expect(terminal.textContent).not.toContain("test-only-password");
  expect(Object.values(localStorage).join("")).not.toContain("test-only-password");
  fireEvent.change(command, { target: { value: ":q" } });
  fireEvent.keyDown(command, { key: "Enter" });
  expect(within(terminal).queryByRole("region", { name: "账户" })).toBeNull();
  expect(screen.getByTestId("identity").textContent).toBe("终端读者");
});

it("switches an already running login program to register when the account command changes", async () => {
  render(<AccountProvider><Harness /></AccountProvider>);
  fireEvent.click(screen.getByRole("button", { name: "启动登录" }));
  await screen.findByRole("button", { name: "登录账户" });
  fireEvent.click(screen.getByRole("button", { name: "启动注册" }));
  expect(screen.getByLabelText("确认密码")).toBeTruthy();
});

it("fills the existing profile when the initial session arrives after opening the program", async () => {
  let finish!: (value: Response) => void;
  const fetch = globalThis.fetch;
  vi.stubGlobal("fetch", (path: string, options?: RequestInit) => path.endsWith("/auth/session") ? new Promise<Response>(resolve => { finish = resolve; }) : fetch(path, options));
  render(<AccountProvider><Harness /></AccountProvider>);
  fireEvent.click(screen.getByRole("button", { name: "启动登录" }));
  await screen.findByRole("button", { name: "登录账户" });
  await act(async () => finish(response({ user: { id: "late-reader", username: "reader", displayName: "已有读者", role: "USER" } })));
  expect((screen.getByLabelText("显示名称") as HTMLInputElement).value).toBe("已有读者");
});
