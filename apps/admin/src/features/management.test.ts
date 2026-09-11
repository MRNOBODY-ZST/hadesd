import { expect, it } from "vitest";
import { runLimited } from "./management";

it("bounds concurrent uploads, continues after a failure, and preserves selection order in results", async () => {
  let active = 0, maximum = 0;
  const finished: number[] = [], progress: number[] = [];
  const results = await runLimited([0, 1, 2, 3, 4, 5], async value => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, value === 0 ? 12 : 2));
    active--; finished.push(value);
    if (value === 1) throw new Error("one file failed");
  }, done => progress.push(done), 3);
  expect(maximum).toBe(3);
  expect(active).toBe(0);
  expect(finished[0]).not.toBe(0);
  expect(results.map(result => result.item)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(results.filter(result => result.ok)).toHaveLength(5);
  expect(results[1]).toMatchObject({ ok: false, error: new Error("one file failed") });
  expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
});
