import { create } from "zustand";
import type { Theme, CrtLevel } from "@hadesd/contracts";
interface Preferences {
  theme: Theme;
  crt: CrtLevel;
  reader: boolean;
  settingsOpen: boolean;
  paletteOpen: boolean;
  explorerOpen: boolean;
  setTheme: (theme: Theme) => void;
  setCrt: (crt: CrtLevel) => void;
  setReader: (on: boolean) => void;
  load: () => void;
  toggle: (
    key: "settingsOpen" | "paletteOpen" | "explorerOpen",
    value?: boolean,
  ) => void;
}
const save = (state: Pick<Preferences, "theme" | "crt" | "reader">) => {
  try {
    localStorage.setItem("hadesd.display.v2", JSON.stringify(state));
  } catch {
    /* local preferences are optional */
  }
};
export const usePreferences = create<Preferences>((set, get) => ({
  theme: "amber",
  crt: "full",
  reader: false,
  settingsOpen: false,
  paletteOpen: false,
  explorerOpen: false,
  setTheme: (theme) => {
    set({ theme, ...(theme === "paper" ? { crt: "off" as const } : {}) });
    const { crt, reader } = get();
    save({ theme, crt, reader });
  },
  setCrt: (crt) => {
    set({ crt });
    const { theme, reader } = get();
    save({ theme, crt, reader });
  },
  setReader: (reader) => {
    set({ reader });
    const { theme, crt } = get();
    save({ theme, crt, reader });
  },
  load: () => {
    try {
      const p = JSON.parse(
        localStorage.getItem("hadesd.display.v2") ?? "{}",
      ) as Record<string, unknown>;
      set({
        theme: ["amber", "green", "paper"].includes(p.theme as string)
          ? (p.theme as Theme)
          : "amber",
        crt: ["off", "low", "full"].includes(p.crt as string)
          ? (p.crt as CrtLevel)
          : "full",
        reader: p.reader === true,
      });
    } catch {
      /* use readable defaults */
    }
  },
  toggle: (key, value) => set({ [key]: value ?? !get()[key] }),
}));
