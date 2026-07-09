"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
  Scroll-reveal wrapper: children stay invisible until the block scrolls into
  view, then fade + slide up once. Respects prefers-reduced-motion (shows
  immediately). Use `delay` (ms) to stagger sibling sections.
*/
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={shown ? { animation: `reveal-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both` } : { opacity: 0 }}
    >
      {children}
    </div>
  );
}
