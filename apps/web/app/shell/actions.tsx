import { createContext, useContext } from "react";
import type { FrozenSite, Navigation } from "@hadesd/terminal-core";
import type { VfsNode } from "@hadesd/contracts";
export interface Actions {
  data: FrozenSite;
  nodes: VfsNode[];
  cwd: string;
  open: (target: Navigation) => void;
}
export const ActionsContext = createContext<Actions | null>(null);
export function useActions() {
  const value = useContext(ActionsContext);
  if (!value) throw new Error("ActionsProvider missing");
  return value;
}
