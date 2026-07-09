"use client";

import { useEffect, useRef, useState } from "react";

/*
  Animated number: counts from 0 to `value` with an ease-out curve on first
  render, and glides between values on updates. Pass `format` to control the
  final text (e.g. inrCompact, toFixed). Reduced-motion users see the value
  immediately.
*/
export function CountUp({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 900,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }
    const from = startedRef.current ? fromRef.current : 0;
    startedRef.current = true;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * eased;
      fromRef.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{format(display)}</>;
}
