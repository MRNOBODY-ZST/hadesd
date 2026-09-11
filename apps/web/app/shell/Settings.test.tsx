import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Settings } from "./Settings";
import { usePreferences } from "./store";

beforeEach(() => usePreferences.setState({ theme: "amber", crt: "full", reader: false, settingsOpen: true }));
afterEach(() => { cleanup(); localStorage.clear(); });

it("applies terminal display commands and retains them after the program exits", async () => {
  render(<Settings />);
  const command = screen.getByLabelText("程序命令");
  fireEvent.change(command, { target: { value: "theme paper" } });
  fireEvent.keyDown(command, { key: "Enter" });
  expect(usePreferences.getState().theme).toBe("paper");
  expect(usePreferences.getState().crt).toBe("off");
  expect(screen.getByRole("button", { name: "纸张" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(command, { key: "Escape" });
  expect(usePreferences.getState().settingsOpen).toBe(false);
  expect(JSON.parse(localStorage.getItem("hadesd.display.v2") || "{}").theme).toBe("paper");
});
