"use client";

import { cn } from "@/lib/utils";
import type { Camera, Site } from "@/lib/types";
import { fmtBlackFor, fmtRelative, zoneLabel } from "@/lib/format";

export function CameraTiles({
  cameras,
  site,
  now,
  activeCameraIds,
}: {
  cameras: Camera[];
  site?: Site;
  now: Date;
  activeCameraIds: Set<string>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-semibold">Cameras</h2>
        <span className="text-sm text-slate-500">
          {cameras.filter((c) => c.online).length} of {cameras.length} online
        </span>
      </header>
      <ul className="grid grid-cols-2 gap-3 p-4 xl:grid-cols-3">
        {cameras.map((c) => {
          const black = !c.online || !!c.black_since;
          const active = activeCameraIds.has(c.camera_id);
          return (
            <li
              key={c.camera_id}
              className={cn(
                "rounded-xl border p-3",
                black
                  ? "border-red-300 bg-red-50"
                  : active
                    ? "border-amber-300 bg-amber-50"
                    : "border-slate-200 bg-slate-50",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    c.online ? "bg-green-500" : "bg-red-500",
                  )}
                  aria-label={c.online ? "online" : "offline"}
                />
                <span className="font-mono text-xs text-slate-500">
                  {c.camera_id}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-semibold">
                {c.location}
              </p>
              <p className="truncate text-xs text-slate-500">
                {zoneLabel(site, c.zone_type)}
              </p>
              {black && c.black_since ? (
                <span className="mt-2 inline-block rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                  {fmtBlackFor(c.black_since, now)}
                </span>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  last frame {fmtRelative(c.last_frame_at, now)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
