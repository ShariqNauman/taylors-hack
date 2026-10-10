"use client";

// The guard-post layer of the 3D campus (Plan, section 1 "Where are the posts?").
// It tells the same story as the 2D map: a numbered blue marker per post on a
// translucent ground disc sized by incidents in 28 days, the guard's picture and
// first name, dashed for "nobody yet" and for the suggested post. Blue and ink
// only: colour means severity elsewhere, never here.
import { useMemo } from "react";
import * as THREE from "three";
import { Line } from "@react-three/drei";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { XY } from "./geo";
import type { PostView } from "./types";

const BLUE = "#2742D9";
const BLUE_INK = "#1F35B3";
const INK = "#0B0D10";

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

const OVERLAY = { depthTest: false, depthWrite: false, transparent: true } as const;

/** Flat ring geometry (a thin annulus) in the XZ plane. */
function ringGeom(r: number, w: number) {
  const g = new THREE.RingGeometry(Math.max(0.1, r - w), r, 64);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Points for a dashed circle outline. */
function circlePts(r: number, y: number, n = 72): [number, number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
}

/**
 * The 3D part of one post: the translucent disc on the ground, a drop line up to
 * the marker for posts on an upper floor, and a figure at the post (a blue guard,
 * or a dashed outline when nobody is assigned). Drawn as an overlay layer so a
 * post inside a building still reads, like the circles on the 2D map.
 */
export function PostMarker3D({ post, selected, onPick }: { post: PlacedPost; selected: boolean; onPick: () => void }) {
  const r = discRadius(post.incidents28d);
  const suggested = post.status === "suggested";
  const dashed = suggested || !post.guard;
  const [x, z] = [post.at[0], -post.at[1]];
  const fill = useMemo(() => {
    const g = new THREE.CircleGeometry(r, 64);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [r]);
  const solidRing = useMemo(() => ringGeom(r, selected ? 1.6 : 0.7), [r, selected]);
  const outer = useMemo(() => ringGeom(r + 2.6, 0.9), [r]);
  const click = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onPick();
  };
  return (
    <group position={[x, post.discY, z]} renderOrder={30}>
      {/* disc */}
      <mesh geometry={fill} position={[0, 0.35, 0]} renderOrder={30} onClick={click}>
        <meshBasicMaterial color={BLUE} opacity={suggested ? 0.08 : 0.16} {...OVERLAY} />
      </mesh>
      {dashed ? (
        <Line points={circlePts(r, 0.4)} color={BLUE} lineWidth={selected ? 3.5 : 2} dashed dashSize={3.2} gapSize={2.2} renderOrder={31} {...OVERLAY} />
      ) : (
        <mesh geometry={solidRing} position={[0, 0.4, 0]} renderOrder={31}>
          <meshBasicMaterial color={BLUE} {...OVERLAY} />
        </mesh>
      )}
      {selected && (
        <mesh geometry={outer} position={[0, 0.4, 0]} renderOrder={31}>
          <meshBasicMaterial color={INK} {...OVERLAY} />
        </mesh>
      )}
      {/* drop line from the disc up to a marker on an upper floor */}
      {post.y - post.discY > 1 && <Line points={[[0, 0.4, 0], [0, post.y - post.discY, 0]]} color={BLUE_INK} lineWidth={1.5} dashed dashSize={1.6} gapSize={1.2} renderOrder={31} {...OVERLAY} />}
      {/* the person at the post */}
      {!suggested && (
        <group position={[0, post.y - post.discY, 0]} scale={1.6} onClick={click}>
          {post.guard ? <GuardFigure selected={selected} /> : <EmptyFigure />}
        </group>
      )}
    </group>
  );
}

/** A small low-poly guard (about 7 m at diorama scale) in patrol blue. */
function GuardFigure({ selected }: { selected: boolean }) {
  const c = selected ? BLUE_INK : BLUE;
  const mat = <meshBasicMaterial color={c} {...OVERLAY} opacity={0.95} />;
  return (
    <group renderOrder={32}>
      <mesh position={[-0.5, 1.2, 0]} renderOrder={32}>
        <cylinderGeometry args={[0.38, 0.42, 2.4, 8]} />
        {mat}
      </mesh>
      <mesh position={[0.5, 1.2, 0]} renderOrder={32}>
        <cylinderGeometry args={[0.38, 0.42, 2.4, 8]} />
        {mat}
      </mesh>
      <mesh position={[0, 3.7, 0]} renderOrder={32}>
        <capsuleGeometry args={[0.95, 1.6, 4, 10]} />
        {mat}
      </mesh>
      <mesh position={[0, 5.9, 0]} renderOrder={32}>
        <sphereGeometry args={[0.85, 14, 10]} />
        <meshBasicMaterial color="#F3E3CF" {...OVERLAY} />
      </mesh>
      <mesh position={[0, 6.35, 0]} renderOrder={33}>
        <sphereGeometry args={[0.88, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        {mat}
      </mesh>
    </group>
  );
}

/** "Nobody yet": the dashed outline of a person, in ink, so the gap is visible. */
function EmptyFigure() {
  const outline = useMemo<[number, number, number][]>(() => {
    // Front-facing silhouette: legs, body, shoulders, head, traced once.
    const head: [number, number][] = Array.from({ length: 17 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      return [Math.cos(a) * 0.9, 5.9 + Math.sin(a) * 0.9];
    });
    const body: [number, number][] = [
      [-0.9, 0], [-0.15, 0], [-0.15, 2.3], [0.15, 2.3], [0.15, 0], [0.9, 0], [0.95, 2.6], [1.25, 4.6], [0.9, 5.0], [0.2, 5.0],
      ...head,
      [-0.2, 5.0], [-0.9, 5.0], [-1.25, 4.6], [-0.95, 2.6], [-0.9, 0],
    ];
    return body.map(([px, py]) => [px, py, 0]);
  }, []);
  return (
    <group renderOrder={32}>
      <Line points={outline} color={INK} lineWidth={2} dashed dashSize={0.5} gapSize={0.35} renderOrder={32} {...OVERLAY} />
      <Line points={outline} color={INK} lineWidth={2} dashed dashSize={0.5} gapSize={0.35} rotation={[0, Math.PI / 2, 0]} renderOrder={32} {...OVERLAY} />
    </group>
  );
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
