"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useSyncExternalStore } from "react";
import { usingMock } from "@/lib/api";
import { cameraKind } from "@/lib/camera-meta";
import type { Camera } from "@/lib/types";
import { useAppStore } from "@/lib/store/app-store";
import { Logo } from "./logo";
import { AlarmBanner } from "@/components/alarm/alarm-banner";
import { DemoVideoModal } from "@/components/demo-video-modal";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/cameras", label: "Cameras" },
  { href: "/plan", label: "Plan" },
  { href: "/incidents", label: "Incidents" },
  { href: "/proof", label: "Track record" },
  { href: "/reports", label: "Reports" },
];

/**
 * Global shell header (brief §4): logo, site name in mono, nav, a right-side
 * slot for Live's controls, the data-source chip and the view indicator.
 * The alarm banner renders directly under it.
 */
export function SiteHeader({
  cameras,
  children,
}: {
  cameras?: Camera[];
  children?: React.ReactNode;
}) {
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  // Only what needs attention: cameras that are off.
  const off = (cameras ?? []).filter((c) => cameraKind(c) === "black");
  const pathname = usePathname();
  const params = useSearchParams();
  const replay = params.get("replay") === "1";
  const apiDown = useAppStore((s) => s.apiDown);
  const view = useAppStore((s) => s.view);
  // A deployed build (not this laptop or the hotspot) without NEXT_PUBLIC_API_URL: the shared
  // demo store lives in one serverless instance, so it only syncs devices on the same server.
  const deployedDemo = useDeployedDemo();

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Logo />
          <nav aria-label="Main" className="flex flex-wrap gap-0.5">
            {NAV.map((n) => {
              const active =
                n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-[2px] px-3.5 py-2.5 text-[15px] font-bold no-underline transition-colors",
                    active
                      ? "bg-ink text-white"
                      : "text-ink-2 hover:bg-raised hover:text-ink",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2.5">
            {off.length > 0 && (
              <Link
                href={`/cameras?cam=${encodeURIComponent(off[0].camera_id)}`}
                className="inline-flex min-h-7 items-center rounded-[1px] bg-ink px-2 font-mono text-[11px] font-bold tracking-[0.06em] text-white no-underline"
              >
                {off.length} CAMERA{off.length === 1 ? "" : "S"} OFF · {off[0].location.replace(/, corridor /i, " ").toUpperCase()}
              </Link>
            )}
            {children}
            <button
              type="button"
              onClick={() => setVideoModalOpen(true)}
              className="inline-flex min-h-7 items-center gap-1.5 rounded-[1px] bg-[#E11D48] px-2.5 font-mono text-[11px] font-extrabold uppercase tracking-[0.06em] text-white shadow-sm transition hover:bg-[#BE123C]"
              title="Watch physical violence prediction demo video on real surveillance footage"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch ML Demo
            </button>
            <span
              className={cn(
                "inline-flex min-h-7 items-center rounded-[1px] border px-2 font-mono text-[11px] font-bold tracking-[0.06em]",
                view === "onsite"
                  ? "border-ink bg-ink text-white"
                  : "border-[#A9B6F2] bg-signal-tint text-signal-ink",
              )}
              title={
                view === "onsite"
                  ? "Edge laptop reachable: video allowed"
                  : "Remote link: skeletons and data only, no video"
              }
            >
              {view === "onsite"
                ? "ON-SITE DESK"
                : view === "remote"
                  ? "REMOTE LINK"
                  : "DETECTING…"}
            </span>
            {deployedDemo ? (
              <span
                className="inline-flex min-h-7 items-center rounded-[1px] border border-dashed border-line-strong bg-white px-2 font-mono text-[11px] font-bold tracking-[0.06em] text-ink-2"
                title="This deployed link has no API: demo data. What you change is kept by this server, not shared with other people or devices reliably."
              >
                DEMO DATA · CHANGES STAY ON THIS DEVICE
              </span>
            ) : (
              (usingMock || apiDown) && (
                <span
                  className="inline-flex min-h-7 items-center rounded-[1px] border border-dashed border-line-strong bg-white px-2 font-mono text-[11px] font-bold tracking-[0.06em] text-ink-2"
                  title={
                    apiDown
                      ? "API failed; showing mock data"
                      : "No API configured; showing mock data"
                  }
                >
                  MOCK DATA
                </span>
              )
            )}
            {replay && (
              <span className="inline-flex min-h-7 items-center rounded-[1px] border border-ink bg-white px-2 font-mono text-[11px] font-bold tracking-[0.06em]">
                REPLAY
              </span>
            )}
          </div>
        </div>
      </header>
      <AlarmBanner />
      <DemoVideoModal open={videoModalOpen} onClose={() => setVideoModalOpen(false)} />
    </>
  );
}

const LOCAL_HOST = /^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$|\.localhost$|\.trycloudflare\.com$/;
function useDeployedDemo(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => usingMock && !LOCAL_HOST.test(window.location.hostname),
    () => false,
  );
}
