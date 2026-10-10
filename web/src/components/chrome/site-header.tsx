"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { usingMock } from "@/lib/api";
import { useAppStore } from "@/lib/store/app-store";
import { Logo } from "./logo";
import { AlarmBanner } from "@/components/alarm/alarm-banner";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/cameras", label: "Cameras" },
  { href: "/plan", label: "Plan" },
  { href: "/incidents", label: "Incidents" },
  { href: "/proof", label: "Track record" },
];

/**
 * Global shell header (brief §4): logo, site name in mono, nav, a right-side
 * slot for Live's controls, the data-source chip and the view indicator.
 * The alarm banner renders directly under it.
 */
export function SiteHeader({
  siteName,
  cameraCount,
  children,
}: {
  siteName?: string;
  cameraCount?: number;
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const replay = params.get("replay") === "1";
  const apiDown = useAppStore((s) => s.apiDown);
  const view = useAppStore((s) => s.view);

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Logo />
          <span className="hidden font-mono text-[13px] uppercase text-muted-ink md:inline">
            {siteName ?? "Site"}
            {cameraCount != null ? ` · ${cameraCount} cameras` : ""}
          </span>
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
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            {children}
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
            {(usingMock || apiDown) && (
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
    </>
  );
}
