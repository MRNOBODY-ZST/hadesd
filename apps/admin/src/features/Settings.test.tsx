// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_SITE } from "@hadesd/contracts";
import Settings from "./Settings";
import { api } from "../api";
import { useUi } from "../store";

vi.mock("./Publishing", () => ({ usePublish: () => ({ mutate: vi.fn(), isPending: false }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); useUi.getState().setDirty(false, false); });

it("loads legacy settings and saves a custom intro title without discarding other settings", async () => {
  const legacy = { ...DEFAULT_SITE, title: "林间笔记", heroTitle: null };
  vi.spyOn(api, "settings").mockResolvedValue(legacy);
  const save = vi.spyOn(api, "saveSettings").mockImplementation(async value => value);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Settings /></QueryClientProvider>);
  const field = await screen.findByLabelText(/开场标题/);
  expect((field as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(field, { target: { value: "记录日常，\n分享发现。" } });
  fireEvent.submit(document.querySelector("#site-settings")!);
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0]).toEqual({ ...legacy, heroTitle: "记录日常，\n分享发现。" });
  expect(await screen.findByText("站点设置已保存。发布一个新版本后，公开站点会更新。")).toBeTruthy();
});
