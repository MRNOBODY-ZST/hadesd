import { create } from "zustand";
import type { PublishRequest } from "@hadesd/contracts";
export type View = "contents" | "editor" | "media" | "releases" | "settings" | "comments";
export interface Route {
  view: View;
  id?: string;
}
export function readRoute(): Route {
  const [view, id] = window.location.hash.replace(/^#\/?/, "").split("/");
  if (view === "editor" && id) {
    try {
      return { view, id: decodeURIComponent(id) };
    } catch {
      return { view: "contents" };
    }
  }
  return {
    view: ["contents", "media", "releases", "settings", "comments"].includes(view)
      ? (view as View)
      : "contents",
  };
}
interface UiState {
  route: Route;
  dirty: boolean;
  pendingSave: boolean;
  job: { id: string; request?: PublishRequest } | null;
  setRoute: (route: Route) => void;
  setDirty: (dirty: boolean, pendingSave?: boolean) => void;
  trackJob: (id: string, request?: PublishRequest) => void;
}
function storedJob(): UiState["job"] {
  try {
    return JSON.parse(
      sessionStorage.getItem("hadesd:last-job") || "null",
    ) as UiState["job"];
  } catch {
    return null;
  }
}
export const useUi = create<UiState>((set) => ({
  route: readRoute(),
  dirty: false,
  pendingSave: false,
  job: storedJob(),
  setRoute: (route) => set({ route }),
  setDirty: (dirty, pendingSave = false) => set({ dirty, pendingSave }),
  trackJob: (id, request) => {
    const job = { id, request };
    try {
      sessionStorage.setItem("hadesd:last-job", JSON.stringify(job));
    } catch {
      /* Restricted storage does not prevent publishing. */
    }
    set({ job });
  },
}));
export function navigate(route: Route): boolean {
  const { dirty, pendingSave } = useUi.getState();
  if (
    (dirty || pendingSave) &&
    !window.confirm(
      pendingSave
        ? "内容正在保存，离开可能无法确认保存结果。仍然离开？"
        : "还有未保存的修改，确定离开并放弃这些修改？",
    )
  )
    return false;
  useUi.getState().setDirty(false);
  useUi.getState().setRoute(route);
  window.location.hash = `/${route.view}${route.id ? `/${encodeURIComponent(route.id)}` : ""}`;
  return true;
}
