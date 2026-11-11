import { useEffect, useState } from "react";
import monday from "./ghosts/ghost-monday.svg?no-inline";
import tuesday from "./ghosts/ghost-tuesday.svg?no-inline";
import wednesday from "./ghosts/ghost-wednesday.svg?no-inline";
import thursday from "./ghosts/ghost-thursday.svg?no-inline";
import friday from "./ghosts/ghost-friday.svg?no-inline";
import saturday from "./ghosts/ghost-saturday.svg?no-inline";
import sunday from "./ghosts/ghost-sunday.svg?no-inline";

export const ghostIcons = [monday, tuesday, wednesday, thursday, friday, saturday, sunday] as const;
const DAY_MS = 86_400_000;
// Asia/Shanghai uses UTC+08:00; both sites follow this calendar, not the visitor's.
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
export function ghostDay(date = new Date()): number {
  return (new Date(date.getTime() + SHANGHAI_OFFSET_MS).getUTCDay() + 6) % 7;
}
export function nextGhostChange(date = new Date()): number {
  const localTime = date.getTime() + SHANGHAI_OFFSET_MS;
  return DAY_MS - ((localTime % DAY_MS + DAY_MS) % DAY_MS) + 10;
}

/** One icon link, shared by both frontends; no server rebuild or scheduled job. */
export function DailyFavicon() {
  // A deterministic SSR fallback avoids freezing the build day's icon forever
  // and keeps hydration identical; the first effect selects today's asset.
  const [day, setDay] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const now = new Date();
      setDay(ghostDay(now));
      timer = setTimeout(update, nextGhostChange(now));
    };
    const visible = () => { if (!document.hidden) update(); };
    update();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pageshow", update);
    window.addEventListener("focus", update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", update);
      window.removeEventListener("focus", update);
    };
  }, []);
  return <link rel="icon" type="image/svg+xml" sizes="any" href={ghostIcons[day]} data-ghost-day={day + 1} />;
}
