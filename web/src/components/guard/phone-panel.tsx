"use client";

// Demo: the pushed guard's phone screen beside the desk, in a phone frame. The same guard app as
// on a real phone (/guard), so the real phone and this frame both ring.
import { useEffect, useState } from "react";
import useSWR from "swr";
import { getSite } from "@/lib/api";
import { team } from "@/lib/posts";
import { useAppStore } from "@/lib/store/app-store";

const W = 390;
const H = 844;
const BEZEL = 10;

export function PhonePanel() {
  const phone = useAppStore((s) => s.phone);
  const close = useAppStore((s) => s.closePhone);
  const { data: site } = useSWR(phone ? "site" : null, getSite, { revalidateOnFocus: false });
  const [scale, setScale] = useState(0.8);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 96) / (H + 2 * BEZEL)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    if (!phone) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [phone, close]);
  const w = (W + 2 * BEZEL) * scale;
  const h = (H + 2 * BEZEL) * scale;
  // Beside the desk, not over it: the page makes room on the right while the phone is open.
  useEffect(() => {
    if (!phone || window.innerWidth < 1100) return;
    const body = document.body;
    const before = body.style.paddingRight;
    body.style.paddingRight = `${Math.round(w + 32)}px`;
    return () => {
      body.style.paddingRight = before;
    };
  }, [phone, w]);
  if (!phone) return null;
  const name = team(site?.staff).find((p) => p.id === phone)?.name ?? phone;
  return (
    <aside
      aria-label={`${name}'s phone`}
      className="fixed right-4 bottom-4 z-40 hidden flex-col items-end gap-1.5 min-[1100px]:flex"
    >
      <div className="flex items-center gap-2 rounded-[2px] bg-ink px-2.5 py-1.5 text-white shadow-[0_6px_24px_rgba(11,13,16,0.25)]">
        <span className="font-mono text-[11px] font-bold tracking-[0.06em]">{name.toUpperCase()}&rsquo;S PHONE</span>
        <button type="button" onClick={close} className="min-h-8 rounded-[2px] border border-white/60 px-2.5 text-[13px] font-extrabold">
          Close ✕
        </button>
      </div>
      <div style={{ width: w, height: h }} className="relative">
        <div
          className="absolute top-0 left-0 overflow-hidden bg-ink shadow-[0_12px_40px_rgba(11,13,16,0.35)]"
          style={{
            width: W + 2 * BEZEL,
            height: H + 2 * BEZEL,
            padding: BEZEL,
            borderRadius: 46,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <iframe
            key={phone}
            title={`${name}'s phone screen`}
            src={`/guard?staff=${encodeURIComponent(phone)}&embed=1`}
            width={W}
            height={H}
            className="block border-0 bg-white"
            style={{ borderRadius: 36 }}
          />
        </div>
      </div>
    </aside>
  );
}
