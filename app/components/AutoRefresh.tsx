"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Re-fetches server data every few minutes and whenever the tab regains focus. */
export function AutoRefresh({ everyMs = 5 * 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  const last = useRef(Date.now());

  useEffect(() => {
    const refresh = () => {
      last.current = Date.now();
      router.refresh();
    };
    const timer = setInterval(refresh, everyMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current > 60_000) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, everyMs]);

  return null;
}
