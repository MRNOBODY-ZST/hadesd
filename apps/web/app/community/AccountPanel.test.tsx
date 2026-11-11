import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MyFiles } from "./AccountPanel";

const mocks = vi.hoisted(() => ({ files: vi.fn(), upload: vi.fn() }));
vi.mock("./api", () => ({ community: mocks, errorText: (e: Error) => e.message, fileSize: (n: number) => `${n} B`, fileUrl: (id: string) => `/file/${id}` }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("retains an upload rejection after refreshing the list of already uploaded files", async () => {
  mocks.files.mockResolvedValue({ items: [], page: 0, size: 10, total: 0 });
  mocks.upload.mockRejectedValue(new Error("文件超过大小限制"));
  render(<MyFiles />);
  await waitFor(() => expect(screen.getByText("暂无文件。上传图片后，可在评论中使用它的文件 ID。")).toBeTruthy());
  await act(async () => fireEvent.change(screen.getByLabelText("上传文件"), { target: { files: [new File(["test"], "picture.png", { type: "image/png" })] } }));
  await waitFor(() => expect(mocks.files).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("alert").textContent).toContain("文件超过大小限制");
  expect((screen.getByLabelText("上传文件") as HTMLInputElement).disabled).toBe(false);
});
