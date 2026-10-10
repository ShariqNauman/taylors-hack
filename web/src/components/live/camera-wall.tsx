"use client";

import Link from "next/link";
import type { Camera, Site } from "@/lib/types";
import { LEVEL_LABEL, LEVEL_THEME } from "@/lib/format";
import { cameraKind, kindSuffix, tileTimeLine } from "@/lib/camera-meta";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";
import { CameraFeed } from "@/components/camera/camera-feed";
import type { LiveEvent } from "./use-live-feed";

export function CameraWall({
  cameras,
  site,
  active,
  selectedId,
  pulsingCams,
  now,
}: {
  cameras: Camera[];
  site?: Site;
  active: LiveEvent[];
  selectedId: string | null;
  pulsingCams: Set<string>;
  now: Date;
}) {
  const view = useAppStore((s) => s.view);
  const counts = {
    live: cameras.filter((c) => cameraKind(c) === "live").length,
    rec: cameras.filter((c) => cameraKind(c) === "recorded").length,
    black: cameras.filter((c) => cameraKind(c) === "black").length,
  };
  return (
    <section aria-labelledby="wall-h" className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="wall-h" className="ee-display text-[24px]">
          <Link href="/cameras" className="text-ink no-underline">
            Camera wall
          </Link>
        </h2>
        <span className="font-mono text-[12px] text-muted-ink">
          {view === "onsite"
            ? `ON SITE: ${counts.live} LIVE WEBCAM · ${counts.rec} LABELLED RECORDINGS · ${counts.black} BLACK`
            : "REMOTE: SKELETONS DURING INCIDENTS, PEOPLE COUNTS OTHERWISE"}
        </span>
        <Link
          href="/cameras"
          className="text-[14px] font-extrabold text-signal"
        >
          All cameras and the 3D campus
        </Link>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
        {cameras.map((c) => {
          const kind = cameraKind(c);
          const inc = active.find((e) => e.camera_id === c.camera_id);
          const level = kind === "black" ? null : (inc?.level ?? "calm");
          const t = level ? LEVEL_THEME[level] : null;
          const pulse = pulsingCams.has(c.camera_id);
          const sel = inc && inc.incident_id === selectedId;
          return (
            <Link
              key={c.camera_id}
              href={`/cameras?cam=${encodeURIComponent(c.camera_id)}`}
              aria-label={`${c.camera_id}, ${c.location}${kind === "recorded" ? ", recording" : kind === "live" ? ", live webcam" : ", no signal"}${level ? `, ${LEVEL_LABEL[level]}` : ""}. Open all cameras.`}
              className={cn(
                "flex flex-col overflow-hidden rounded-[2px] bg-white text-ink no-underline",
                pulse && "ee-pulse",
              )}
              style={{
                border: pulse
                  ? "2px solid #C8241B"
                  : sel && t
                    ? `2px solid ${t.border}`
                    : "1px solid #DCDFE4",
              }}
            >
              <div className="relative">
                <CameraFeed
                  camera={c}
                  frame={
                    view === "onsite" || inc
                      ? (inc?.snapshot ?? inc?.peak_snapshot)
                      : null
                  }
                  level={level ?? "calm"}
                  showBox={false}
                  stroke={6}
                  now={now}
                />
                <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-[1px] bg-[rgb(11_13_16/0.75)] px-1.5 py-0.5 font-mono text-[11px] font-bold text-white">
                  <span
                    className="size-[7px] rounded-full"
                    style={{
                      background:
                        kind === "black"
                          ? "#8B939E"
                          : kind === "live"
                            ? "#FF453A"
                            : "#AEB7C2",
                    }}
                    aria-hidden
                  />
                  {c.camera_id}
                  {kindSuffix(kind)}
                </span>
                <span
                  className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-[1px] border px-1.5 py-0.5 text-[11px] font-extrabold uppercase"
                  style={
                    t
                      ? {
                          background: t.pillBg,
                          color: t.pillFg,
                          borderColor: t.pillBorder,
                        }
                      : {
                          background: "#FFFFFF",
                          color: "#0B0D10",
                          borderColor: "#FFFFFF",
                        }
                  }
                >
                  {level ? LEVEL_LABEL[level] : "No signal"}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1.5 px-2.5 py-2">
                <span className="truncate text-[14px] font-extrabold">
                  {c.location}
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] text-muted-ink">
                  {tileTimeLine(c)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      {!cameras.length && (
        <p className="text-[15px] text-ink-2">Loading cameras…</p>
      )}
      <span className="sr-only">{site?.name}</span>
    </section>
  );
}
