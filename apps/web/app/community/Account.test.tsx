import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountNotice, AccountProvider, useAccount } from "./Account";
import type { UserAccount } from "@hadesd/contracts";

const mocks = vi.hoisted(() => ({ session: vi.fn(), logout: vi.fn() }));
vi.mock("./api", () => ({ community: mocks, errorText: (e: Error) => e.message }));
const reader: UserAccount = { id: "reader-1", username: "reader", displayName: "读者", role: "USER" };
function Harness() {
  const account = useAccount();
  return <><AccountNotice /><span data-testid="identity">{account.user?.username || "guest"}</span><span data-testid="program">{account.view || "shell"}</span><input aria-label="未提交草稿" defaultValue="保留这段评论" /><button onClick={() => account.setUser(reader)}>完成登录</button><button onClick={() => account.open("login")}>打开账户程序</button><button onClick={() => { void account.logout().catch(() => {}); }}>退出账户</button></>;
}
beforeEach(() => { mocks.session.mockReset(); mocks.logout.mockReset(); mocks.session.mockResolvedValue({ user: null }); });
afterEach(cleanup);

it("exposes the selected program without mounting UI outside the terminal host", async () => {
  const { container } = render(<AccountProvider><Harness /></AccountProvider>);
  fireEvent.click(screen.getByRole("button", { name: "打开账户程序" }));
  await act(async () => {});
  expect(screen.getByTestId("program").textContent).toBe("login");
  expect(container.querySelector("[data-terminal-program], dialog")).toBeNull();
});

it("does not let a delayed anonymous session response overwrite a completed login", async () => {
  let finish!: (value: { user: null }) => void;
  mocks.session.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<AccountProvider><Harness /></AccountProvider>);
  fireEvent.click(screen.getByRole("button", { name: "完成登录" }));
  expect(screen.getByTestId("identity").textContent).toBe("reader");
  await act(async () => finish({ user: null }));
  expect(screen.getByTestId("identity").textContent).toBe("reader");
});

it("clears an expired identity while preserving the mounted comment draft", async () => {
  mocks.session.mockResolvedValue({ user: reader });
  render(<AccountProvider><Harness /></AccountProvider>);
  await act(async () => {});
  expect(screen.getByTestId("identity").textContent).toBe("reader");
  fireEvent(window, new Event("hadesd:account-expired"));
  expect(screen.getByTestId("identity").textContent).toBe("guest");
  expect((screen.getByLabelText("未提交草稿") as HTMLInputElement).value).toBe("保留这段评论");
  expect(screen.getByRole("status").textContent).toContain("会话已过期");
});

it("keeps the identity until the server actually accepts logout", async () => {
  mocks.session.mockResolvedValue({ user: reader });
  mocks.logout.mockRejectedValue(new Error("网络中断"));
  render(<AccountProvider><Harness /></AccountProvider>);
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "退出账户" }));
  await act(async () => {});
  expect(screen.getByTestId("identity").textContent).toBe("reader");
  mocks.logout.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "退出账户" }));
  await act(async () => {});
  expect(screen.getByTestId("identity").textContent).toBe("guest");
});
