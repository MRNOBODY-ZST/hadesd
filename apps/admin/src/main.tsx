import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ApiError } from "./api";
import "./global.css";
import "@hadesd/ui/crt.css";
const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) =>
        !(
          error instanceof ApiError && [401, 403, 404].includes(error.status)
        ) && count < 1,
    },
    mutations: { retry: false },
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
      <div className="system-crt-glass system-crt-glass--admin" aria-hidden="true" />
    </QueryClientProvider>
  </StrictMode>,
);
