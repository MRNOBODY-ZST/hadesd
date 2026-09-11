// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublishJob } from "@hadesd/contracts";
import { useUi } from "../store";
import { JobStatus } from "./Publishing";

afterEach(() => { cleanup(); useUi.setState({ job: null }); vi.restoreAllMocks(); });

it("refreshes media protection for every completed publish, withdraw and rollback, including cached completed jobs", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const mediaKey = ["media", 0, 20, "", "all", "all"], referenceKey = ["media-references", "file", 0];
  const seed = () => {
    client.setQueryData(mediaKey, { items: [{ id: "file", canDeleteHistory: true }], total: 1 });
    client.setQueryData(referenceKey, { items: [], total: 0 });
  };
  const job = (id: string, operation: PublishJob["operation"], status: PublishJob["status"] = "SUCCEEDED"): PublishJob => ({ id, operation, status, releaseId: `release-${id}`, attempts: 1, createdAt: "2026-09-12T00:00:00Z" });
  client.setQueryData(["job", "publish"], job("publish", "PUBLISH"));
  useUi.setState({ job: { id: "publish" } });
  seed();
  render(<QueryClientProvider client={client}><JobStatus /></QueryClientProvider>);
  await waitFor(() => expect(client.getQueryState(mediaKey)?.isInvalidated).toBe(true));
  expect(client.getQueryState(referenceKey)?.isInvalidated).toBe(true);
  seed();
  client.setQueryData(["job", "withdraw"], job("withdraw", "WITHDRAW"));
  act(() => useUi.setState({ job: { id: "withdraw" } }));
  await waitFor(() => expect(client.getQueryState(mediaKey)?.isInvalidated).toBe(true));
  expect(client.getQueryState(referenceKey)?.isInvalidated).toBe(true);
  seed();
  client.setQueryData(["job", "rollback"], job("rollback", "ROLLBACK", "FAILED"));
  act(() => useUi.setState({ job: { id: "rollback" } }));
  expect(client.getQueryState(mediaKey)?.isInvalidated).toBe(false);
  act(() => client.setQueryData(["job", "rollback"], job("rollback", "ROLLBACK")));
  await waitFor(() => expect(client.getQueryState(mediaKey)?.isInvalidated).toBe(true));
  expect(client.getQueryState(referenceKey)?.isInvalidated).toBe(true);
});
