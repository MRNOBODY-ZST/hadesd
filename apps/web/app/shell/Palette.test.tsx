import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EMPTY_SNAPSHOT } from "@hadesd/contracts";
import { ActionsContext } from "./actions";
import { Palette } from "./Palette";
import { usePreferences } from "./store";

afterEach(cleanup);
function Harness() {
  const [route, setRoute] = useState("/");
  return <ActionsContext value={{ data: EMPTY_SNAPSHOT, nodes: [], cwd: "/", open: target => setRoute(target.route) }}><p data-testid="route">{route}</p><Palette onCommand={() => {}} /></ActionsContext>;
}
it("submits the focused search prompt with Enter and closes the search program", () => {
  usePreferences.setState({ paletteOpen: true });
  render(<Harness />);
  const query = screen.getByLabelText("搜索页面或操作");
  fireEvent.change(query, { target: { value: "事务 隔离" } });
  fireEvent.keyDown(query, { key: "Enter" });
  expect(screen.getByTestId("route").textContent).toBe("/search?q=%E4%BA%8B%E5%8A%A1%20%E9%9A%94%E7%A6%BB");
  expect(usePreferences.getState().paletteOpen).toBe(false);
});
