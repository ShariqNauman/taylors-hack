"use client";

import { useEffect, useState } from "react";

/** A Date that ticks every `ms` (default 1 s). */
export function useClock(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
