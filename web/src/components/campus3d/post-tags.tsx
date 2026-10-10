"use client";

// The guard-post tag, info card and legend, shared by the 3D campus and the 2D
// map (components/map2d). No three.js here, so the 2D map stays out of the 3D chunk.
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { XY } from "./geo";
import type { PostView } from "./types";

/** Ground-disc radius in metres. Mirrors the 2D map (r = 14 + max(n, 2) × 4 px at ~0.6 m/px). */
export function discRadius(incidents28d: number): number {
  return 8.4 + 2.4 * Math.max(incidents28d, 2);
}

/** A post placed in the scene: local metres, the height its marker sits at, and its building. */
export interface PlacedPost extends PostView {
  at: XY;
  y: number; // where the person and marker stand, in metres
  discY: number; // where the disc lies: the ground, or the roof for an indoor ground-floor post
  buildingId: string | null;
  side: "left" | "right"; // which side of the marker the tag goes, as on the 2D map
}

// ── HTML: the numbered marker with its tag ──

export function Avatar({ guard, size = 22 }: { guard: NonNullable<PostView["guard"]>; size?: number }) {
  const initials = guard.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  if (guard.photo_url) {
    // eslint-disable-next-line @next/next/no-img-element -- staff photo from site.staff, never committed
    return <img src={guard.photo_url} alt="" width={size} height={size} className="shrink-0 rounded-full bg-raised object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-signal-tint font-mono font-bold text-signal-ink" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {initials}
    </span>
  );
}

/** Marker + tag, e.g. (1) [photo] 1 · Aiman  ·  "2 · Priya · L3"  ·  dashed "Nobody yet"  ·  dashed "+ Suggested". */
export function PostTag({ post, selected, onClick }: { post: PlacedPost; selected: boolean; onClick: () => void }) {
  const suggested = post.status === "suggested";
  const floor = post.floor && post.floor > 0 ? ` · L${post.floor}` : "";
  const label = suggested ? "Suggested" : post.guard ? `${post.rank} · ${post.guard.first}${floor}` : `Nobody yet${floor}`;
  const aria = suggested
    ? `Suggested post at ${post.place}, ${post.daysLabel} ${post.hours}`
    : `Post ${post.rank} at ${post.place}, ${post.daysLabel} ${post.hours}: ${post.guard ? post.guard.name : "nobody yet"}${post.onNow ? ", on now" : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      aria-pressed={selected}
      className={cn(
        "pointer-events-auto absolute left-0 top-0 inline-flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
        post.side === "left" ? "-translate-x-[calc(100%-15px)] flex-row-reverse" : "-translate-x-[15px]",
      )}
    >
      <span
        className={cn(
          "inline-flex size-[30px] shrink-0 items-center justify-center rounded-full border-[3px] font-[family-name:var(--font-saira)] text-[18px] font-extrabold leading-none",
          suggested ? "border-dashed border-signal bg-white text-signal" : "border-white bg-signal text-white",
          selected && "outline-2 outline-offset-1 outline-ink",
        )}
        style={{ boxShadow: "0 1px 2px rgb(11 13 16 / 0.25)" }}
      >
        {suggested ? "+" : post.rank}
      </span>
      <span
        className={cn(
          "inline-flex h-[28px] items-center gap-1.5 rounded-full bg-white pr-2.5 text-[13px] font-extrabold text-signal-ink",
          post.guard && !suggested ? "border-[1.5px] border-signal pl-[3px]" : "border-[1.5px] border-dashed border-signal pl-2.5",
          selected && "border-2 border-ink",
        )}
      >
        {post.guard && !suggested && <Avatar guard={post.guard} />}
        {label}
        {post.onNow && !suggested && (
          <span className="ml-0.5 rounded-[2px] bg-signal px-1.5 py-[1px] font-mono text-[10px] font-bold uppercase tracking-wide text-white">On now</span>
        )}
      </span>
    </button>
  );
}

function sinceText(since?: string): string | null {
  if (!since) return null;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return since;
  const d = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", weekday: "short", day: "numeric", month: "short" }).format(new Date(t));
  return `standing post since ${d.replace(",", "")}`;
}

/** The small card for the selected post. */
export function PostInfoCard({ post, sheet, onClose }: { post: PlacedPost; sheet: boolean; onClose: () => void }) {
  const suggested = post.status === "suggested";
  const since = suggested ? "suggested by today's 06:00 check" : sinceText(post.since);
  return (
    <div
      role="dialog"
      aria-label={`Post ${post.rank}: ${post.place}`}
      className={cn(
        "pointer-events-auto absolute flex flex-col gap-2 bg-white p-3",
        sheet ? "inset-x-0 bottom-0 border-t-2 border-ink" : "right-3 top-3 w-[300px] max-w-[calc(100%-24px)] rounded-[2px] border border-ink",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-saira)] text-[16px] font-extrabold",
            suggested ? "border-2 border-dashed border-signal bg-white text-signal" : "bg-signal text-white",
          )}
        >
          {suggested ? "+" : post.rank}
        </span>
        <span className="font-mono text-[11px] font-bold uppercase text-muted-foreground">{suggested ? "Suggested post" : `Post ${post.rank}`}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto inline-flex size-8 items-center justify-center rounded-[2px] border border-line bg-white">
          <X className="size-3.5" strokeWidth={2.4} aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="ee-display text-[24px] leading-[0.95]">{post.place}</span>
        <span className="text-[14px] font-bold text-ink">
          {post.daysLabel} · {post.hours}
          {post.floor ? ` · level ${post.floor}` : ""}
        </span>
        {since && <span className="text-[13px] text-ink-2">{since}</span>}
      </div>
      {!suggested && (
        <div className={cn("flex items-center gap-2 rounded-[2px] p-2", post.guard ? "border border-line bg-raised" : "border-2 border-dashed border-ink")}>
          {post.guard ? (
            <>
              <Avatar guard={post.guard} size={34} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[15px] font-extrabold">{post.guard.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{post.guard.call_sign}</span>
              </div>
              {post.onNow && <span className="ml-auto rounded-[2px] bg-signal px-1.5 py-[1px] font-mono text-[10px] font-bold uppercase text-white">On now</span>}
            </>
          ) : (
            <span className="text-[15px] font-extrabold">Nobody yet</span>
          )}
        </div>
      )}
      <span className="text-[12px] text-ink-2">{post.incidents28d} incidents here at that hour in the last 28 days.</span>
    </div>
  );
}

/** Same legend as the 2D map. */
export function PostsLegend() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border border-line bg-white/95 px-2 py-1.5 text-[12px] text-ink-2">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex size-[20px] items-center justify-center rounded-full bg-signal text-[11px] font-extrabold text-white">1</span>
        Guard post
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-[22px] rounded-full border-2 border-signal" style={{ background: "rgba(39, 66, 217, 0.16)" }} />
        Bigger = more incidents in 28 days
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[14px] w-[24px] rounded-[7px] border-[1.5px] border-dashed border-signal" />
        Dashed = nobody yet, or suggested
      </span>
    </div>
  );
}
