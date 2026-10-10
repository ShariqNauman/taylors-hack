"use client";

// Section 1, 2D: the campus drawn from the OpenStreetMap GeoJSON, north up, posts numbered.
import { useMemo } from "react";
import useSWR from "swr";
import type { CampusGeoJson, Ring } from "@/components/campus3d/model";
import { toLocal } from "@/components/campus3d/geo";
import type { PostView } from "@/components/campus3d/types";

const W = 520;
const PAD = 14;
const LABELS: Record<string, [string, string?]> = {
  blockab: ["BLOCK A & B", "Grand Hall"],
  blockc: ["BLOCK C"],
  blockd: ["BLOCK D"],
  blocke: ["BLOCK E"],
  syopz: ["SYOPZ MALL", "U Residence above"],
  sports: ["SPORTS CENTRE"],
};

const fetchGeo = (url: string) => fetch(url).then((r) => r.json() as Promise<CampusGeoJson>);

export function PostMap({
  url,
  posts,
  selectedId,
  onSelect,
}: {
  url: string;
  posts: PostView[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const { data: geo } = useSWR(url, fetchGeo, { revalidateOnFocus: false });
  const view = useMemo(() => {
    if (!geo) return null;
    const campus = geo.features.find((f) => f.properties.kind === "campus") ?? geo.features[0];
    const pts = campus.geometry.coordinates[0].map(([lng, lat]) => toLocal(lng, lat));
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    const k = (W - 2 * PAD) / (maxX - minX);
    const H = Math.round((maxY - minY) * k + 2 * PAD);
    const project = (lng: number, lat: number): [number, number] => {
      const [x, y] = toLocal(lng, lat);
      return [PAD + (x - minX) * k, PAD + (maxY - y) * k];
    };
    const d = (ring: Ring) => "M" + ring.map(([x, y]) => project(x, y).map((v) => v.toFixed(1)).join(" ")).join("L") + "Z";
    return { H, k, project, d };
  }, [geo]);

  if (!geo || !view)
    return <div className="aspect-[520/712] w-full rounded-[2px] bg-[#EEF1F4]" aria-busy="true" />;
  const { H, k, project, d } = view;
  const feats = geo.features;
  const centre = (ring: Ring) => {
    const ps = ring.map(([x, y]) => project(x, y));
    return [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
  };
  const fill = { campus: "#FFFFFF", water: "#CFE0F2", pitch: "#E3EEE4", building: "#DDE2E8" } as const;
  const stroke = { campus: "#B4BAC3", water: "#9DBBDA", pitch: "#A9C3AE", building: "#6B7480" } as const;
  const order = ["campus", "water", "pitch", "building"] as const;
  const lake = feats.find((f) => f.properties.kind === "water" && f.properties.name === "Lake");
  const pitches = feats.filter((f) => f.properties.kind === "pitch");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Campus map, north up, with the guard posts numbered"
      className="block h-auto w-full rounded-[2px] bg-[#EEF1F4]"
    >
      {order.flatMap((kind) =>
        feats
          .filter((f) => f.properties.kind === kind)
          .map((f, i) => (
            <path
              key={`${kind}${i}`}
              d={d(f.geometry.coordinates[0])}
              fill={fill[kind]}
              stroke={stroke[kind]}
              strokeWidth={kind === "campus" || kind === "building" ? 1.5 : 1}
              strokeDasharray={kind === "campus" ? "6 4" : undefined}
            />
          )),
      )}
      {lake && (() => { const [x, y] = centre(lake.geometry.coordinates[0]); return <text x={x} y={y} textAnchor="middle" fontSize="14" fontWeight="700" fill="#5A7FA6">LAKE</text>; })()}
      {pitches.length > 0 && (() => { const [x, y] = centre(pitches[pitches.length - 1].geometry.coordinates[0]); return <text x={x} y={y + 22} textAnchor="middle" fontSize="11" fontWeight="700" fill="#5E8A66">PITCHES</text>; })()}
      {feats
        .filter((f) => f.properties.kind === "building" && f.properties.id && LABELS[f.properties.id])
        .map((f) => {
          const [x, y] = centre(f.geometry.coordinates[0]);
          const [a, b] = LABELS[f.properties.id!];
          return (
            <g key={f.properties.id}>
              <text x={x} y={y} textAnchor="middle" fontSize="13" fontWeight="800" fill="#3A414B">{a}</text>
              {b && <text x={x} y={y + 15} textAnchor="middle" fontSize="11" fill="#5D6672">{b}</text>}
            </g>
          );
        })}
      {posts.map((p) => {
        const [x, y] = project(p.geo.lng, p.geo.lat);
        const pending = p.status === "suggested";
        const r = 14 + Math.max(p.incidents28d, 2) * 4;
        const chip = pending ? "Suggested" : p.guard ? p.guard.first : "Nobody yet";
        const cw = Math.round(chip.length * 7.6 + 22);
        const left = x + r + 6 + cw > W - 4;
        const cx = left ? Math.round(x - r - 6 - cw) : Math.round(x + r + 6);
        const sel = selectedId === p.id;
        const dashed = pending || !p.guard;
        return (
          <g
            key={p.id}
            role="button"
            tabIndex={0}
            aria-pressed={sel}
            aria-label={`${pending ? "Suggested post" : `Post ${p.rank}`}: ${p.place}, ${p.daysLabel} ${p.hours}, ${chip}`}
            onClick={() => onSelect(p.id)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(p.id))}
            className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-[4]"
          >
            <circle cx={x} cy={y} r={r} fill="#2742D9" fillOpacity={sel ? 0.28 : 0.16} stroke={sel ? "#0B0D10" : "#2742D9"} strokeWidth={sel ? 3 : 2} strokeDasharray={dashed ? "6 4" : undefined} />
            <circle cx={x} cy={y} r={15} fill={pending ? "#FFFFFF" : "#2742D9"} stroke={pending ? "#2742D9" : "#FFFFFF"} strokeWidth={pending ? 2 : 3} />
            <text x={x} y={y + 7} textAnchor="middle" fontFamily="var(--font-display), sans-serif" fontSize="20" fontWeight="800" fill={pending ? "#2742D9" : "#FFFFFF"}>{pending ? "+" : p.rank}</text>
            <rect x={cx} y={Math.round(y - 13)} width={cw} height={26} rx={13} fill="#FFFFFF" stroke="#2742D9" strokeWidth={1.5} strokeDasharray={dashed ? "4 3" : undefined} />
            <text x={cx + 11} y={Math.round(y + 5)} fontSize="13" fontWeight="800" fill="#1F35B3">{chip}</text>
          </g>
        );
      })}
      <g transform={`translate(${W - 40} 40)`}>
        <path d="M0 -22 L9 6 L0 0 L-9 6 Z" fill="#0B0D10" />
        <text x="0" y="22" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0B0D10">N</text>
      </g>
      <g transform={`translate(20 ${H - 22})`}>
        <rect x="0" y="0" width={(50 * k).toFixed(1)} height="6" fill="#0B0D10" />
        <text x="0" y="-6" fontSize="12" fontWeight="700" fill="#0B0D10">50 m</text>
      </g>
    </svg>
  );
}
