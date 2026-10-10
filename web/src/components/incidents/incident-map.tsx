"use client";

// Small top-down campus map for one incident: footprints as SVG, one pin at the camera.
import useSWR from "swr";
import type { Camera } from "@/lib/types";
import {
  DEFAULT_BUILDINGS_URL,
  type CampusGeoJson,
  type Ring,
} from "@/components/campus3d/model";
import { COLORS } from "@/components/campus3d/theme";

const W = 240;
const H = 160;
const SPAN_M = 300; // map width in metres
const ORDER = ["campus", "water", "pitch", "building"];

const getGeo = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<CampusGeoJson>);

function inside([x, y]: [number, number], ring: Ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      hit = !hit;
  }
  return hit;
}

export function IncidentMap({ camera }: { camera?: Camera }) {
  const { data: geo } = useSWR(DEFAULT_BUILDINGS_URL, getGeo, {
    revalidateOnFocus: false,
  });
  const pin = camera?.geo;
  if (!geo || !pin) {
    return (
      <div
        className="grid aspect-[3/2] w-full max-w-[240px] place-items-center rounded-[2px] border border-line bg-raised text-[12px] text-muted-ink"
        aria-hidden
      >
        {geo ? "No map position for this camera" : "Loading map…"}
      </div>
    );
  }

  // About 300 m of campus around the camera, so the building is readable.
  const k = Math.cos((pin.lat * Math.PI) / 180);
  const s = W / (SPAN_M / 111_320);
  const x0 = pin.lng * k - W / 2 / s;
  const y1 = pin.lat + H / 2 / s;
  const at = (lng: number, lat: number): [number, number] => [
    (lng * k - x0) * s,
    (y1 - lat) * s,
  ];
  const d = (ring: Ring) =>
    "M" +
    ring
      .map(([x, y]) =>
        at(x, y)
          .map((v) => v.toFixed(1))
          .join(" "),
      )
      .join("L") +
    "Z";
  const [px, py] = at(pin.lng, pin.lat);
  const here = geo.features.find(
    (f) =>
      f.properties.kind === "building" &&
      inside([pin.lng, pin.lat], f.geometry.coordinates[0]),
  );
  const fill = (kind: string) =>
    kind === "campus"
      ? COLORS.ground
      : kind === "water"
        ? COLORS.water
        : kind === "pitch"
          ? COLORS.pitch
          : "#FFFFFF";
  const line = (kind: string) =>
    kind === "campus"
      ? COLORS.campusLine
      : kind === "water"
        ? COLORS.waterLine
        : kind === "pitch"
          ? COLORS.pitchLine
          : COLORS.edge;

  return (
    <figure className="m-0 flex w-full max-w-[240px] flex-col gap-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full rounded-[2px] border border-line"
        role="img"
        aria-label={`Campus map: ${camera.location}${here?.properties.name ? `, ${here.properties.name}` : ""}`}
      >
        <rect width={W} height={H} fill={COLORS.background} />
        {[...geo.features]
          .sort(
            (a, b) =>
              ORDER.indexOf(a.properties.kind) -
              ORDER.indexOf(b.properties.kind),
          )
          .map((f, i) => (
            <path
              key={i}
              d={d(f.geometry.coordinates[0])}
              fill={f === here ? "#DCDFE4" : fill(f.properties.kind)}
              stroke={f === here ? "#0B0D10" : line(f.properties.kind)}
              strokeWidth={f === here ? 1.5 : 0.8}
              strokeDasharray={
                f.properties.kind === "campus" ? "4 3" : undefined
              }
            />
          ))}
        <circle cx={px} cy={py} r={9} fill="#0B0D10" opacity={0.15} />
        <circle
          cx={px}
          cy={py}
          r={4.5}
          fill="#0B0D10"
          stroke="#FFFFFF"
          strokeWidth={1.5}
        />
      </svg>
      <figcaption className="text-[12px] text-ink-2">
        {[here?.properties.name ?? camera.location, camera.geo?.floor]
          .filter(Boolean)
          .join(" · ")}
      </figcaption>
    </figure>
  );
}
