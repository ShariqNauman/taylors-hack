"use client";

import { useEffect, useRef, useState } from "react";

/** The one small "How this works" popover per page: the explanation that used to be on screen. */
export function HowItWorks({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-strong bg-white px-2.5 text-[13px] font-bold text-ink-2"
      >
        <span aria-hidden="true" className="inline-flex size-[18px] items-center justify-center rounded-full border border-current font-mono text-[11px]">i</span>
        How this works
      </button>
      {open && (
        <span role="dialog" aria-label="How this works" className="absolute top-full left-0 z-30 mt-1.5 flex w-[min(420px,calc(100vw-32px))] flex-col gap-2 rounded-[2px] border border-ink bg-white p-3.5 text-[14px] leading-[1.5] font-normal text-ink shadow-[0_6px_24px_rgba(11,13,16,0.14)]">
          {children}
        </span>
      )}
    </span>
  );
}
