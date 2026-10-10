"use client";

// No-WebGL fallback: the same footprints, flat and top-down, as SVG.
import type { CampusGeoJson, Ring } from "./model";
import { COLORS } from "./theme";

export function FlatMap({
  geo,
  width,
  height,
  project,
  alarmBuildingId,
  selectedBuildingId,
  columns,
  route,
  onBuilding,
}: {
  geo: CampusGeoJson;
  width: number;
  height: number;
  project: (lng: number, lat: number, z?: number) => [number, number];
  alarmBuildingId: string | null;
  selectedBuildingId: string | null;
  columns: { lng: number; lat: number }[];
  route: [number, number][] | null;
  onBuilding: (id: string) => void;
}) {
  const d = (ring: Ring) =>
    "M" +
    ring
      .map(([x, y]) => {
        const p = project(x, y);
        return `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      })
      .join("L") +
    "Z";
  const feats = geo.features;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="absolute inset-0 block"
      role="img"
      aria-label="Top-down map of the campus footprints (3D is not available in this browser)"
    >
      <rect width={width} height={height} fill={COLORS.background} />
      {feats
        .filter((f) => f.properties.kind === "campus")
        .map((f, i) => (
          <path
            key={`c${i}`}
            d={d(f.geometry.coordinates[0])}
            fill={COLORS.ground}
            stroke={COLORS.campusLine}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        ))}
      {feats
        .filter((f) => f.properties.kind === "water")
        .map((f, i) => (
          <path key={`w${i}`} d={d(f.geometry.coordinates[0])} fill={COLORS.water} stroke={COLORS.waterLine} strokeWidth={1.5} />
        ))}
      {feats
        .filter((f) => f.properties.kind === "pitch")
        .map((f, i) => (
          <path key={`p${i}`} d={d(f.geometry.coordinates[0])} fill={COLORS.pitch} stroke={COLORS.pitchLine} strokeWidth={1.5} />
        ))}
      {feats
        .filter((f) => f.properties.kind === "building")
        .map((f, i) => {
          const id = f.properties.id ?? `b${f.properties.osm_way ?? i}`;
          const alarm = id === alarmBuildingId;
          const sel = id === selectedBuildingId;
          return (
            <path
              key={id}
              d={d(f.geometry.coordinates[0])}
              fill={alarm ? COLORS.alarmTop : sel ? COLORS.selectedTop : "#FFFFFF"}
              stroke={alarm ? COLORS.alarmLine : sel ? COLORS.selectedLine : COLORS.edge}
              strokeWidth={alarm || sel ? 2 : 1.2}
              style={{ cursor: "pointer" }}
              onClick={() => onBuilding(id)}
            />
          );
        })}
      {columns.map((c, i) => {
        const p = project(c.lng, c.lat);
        return <circle key={i} cx={p[0]} cy={p[1]} r={7} fill="#3653DC" stroke="#1F35B3" strokeWidth={1.5} />;
      })}
      {route && (
        <polyline
          points={route.map(([x, y]) => project(x, y).join(",")).join(" ")}
          fill="none"
          stroke={COLORS.route}
          strokeWidth={3}
          strokeDasharray="6 5"
        />
      )}
    </svg>
  );
}
