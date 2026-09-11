import { useEffect, useState } from "react";

export function useDebouncedSearch(value: string, delay = 250) {
  const [query, setQuery] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setQuery(value.trim()), delay); return () => clearTimeout(timer); }, [value, delay]);
  return query;
}

export type BatchOutcome<T> = { item: T; ok: true } | { item: T; ok: false; error: unknown };
/** Keep upload pressure bounded, preserving a result for every selected file. */
export async function runLimited<T>(items: readonly T[], operation: (item: T) => Promise<unknown>, onProgress: (done: number) => void, concurrency = 3): Promise<BatchOutcome<T>[]> {
  const results = new Array<BatchOutcome<T>>(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++, item = items[index]!;
      try { await operation(item); results[index] = { item, ok: true }; }
      catch (error) { results[index] = { item, ok: false, error }; }
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, worker));
  return results;
}
