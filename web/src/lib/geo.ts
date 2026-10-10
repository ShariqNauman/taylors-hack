import type { Camera, GeoPoint, Site, Staff } from "./types";

/** Great-circle distance in metres. */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "~40 m", rounded to 10 m. */
export function fmtDistance(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  return `~${Math.max(10, Math.round(m / 10) * 10)} m`;
}

/** Distance from a named staff member's post to a camera, if both have a position. */
export function staffDistance(
  site: Site | undefined,
  name: string | null | undefined,
  camera: Camera | undefined,
): number | null {
  if (!site?.staff || !name || !camera?.geo) return null;
  const s = site.staff.find((x) => x.name === name);
  if (!s?.post) return null;
  return haversineM(s.post, camera.geo);
}

/** Nearest on-duty person with a post to a camera. */
export function nearestOnDuty(
  site: Site | undefined,
  camera: Camera | undefined,
): { staff: Staff; metres: number } | null {
  if (!site?.staff || !camera?.geo) return null;
  let best: { staff: Staff; metres: number } | null = null;
  for (const s of site.staff) {
    if (!s.on_duty || !s.post) continue;
    const m = haversineM(s.post, camera.geo);
    if (!best || m < best.metres) best = { staff: s, metres: m };
  }
  return best;
}
