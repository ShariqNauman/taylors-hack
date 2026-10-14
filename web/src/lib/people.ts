// Where the team is right now, for "nearest guard" (backend handoff v3, rule 7):
// a guard checked in at an active post during its hours stands at that post;
// otherwise at their base post. Only people on duty count.
import { haversineM } from "./geo";
import { activePosts, myt, onDutyNow, type Person, slotDays, slotSpan } from "./posts";
import type { Camera, GeoPoint, PatrolPlan, PatrolSlot } from "./types";

export interface Whereabouts {
  person: Person;
  geo: GeoPoint | null;
  /** "at the Block C post" or "at base" */
  where: string;
  post?: PatrolSlot;
  metres: number | null;
}

export type PostGeo = (s: PatrolSlot) => GeoPoint | null;

/** "Block C stairwell" → "the Block C post"; "Sports pitch" → "the sports pitch post". */
export function postName(location: string): string {
  const short = location.replace(/ stairwell$/i, "").replace(/, corridor .*$/i, "").replace(/ food court$/i, "");
  const lower = /^[A-Z][a-z]+ [a-z]/.test(short) ? short[0].toLowerCase() + short.slice(1) : short;
  return `the ${lower} post`;
}

export function whereabouts(
  people: Person[],
  plan: PatrolPlan | undefined,
  postGeo: PostGeo,
  now: number,
): Whereabouts[] {
  const n = myt(now);
  const posts = activePosts(plan?.slots ?? []);
  return people
    .filter((p) => onDutyNow(p, now))
    .map((p) => {
      const at = posts.find((s) => {
        const [a, b] = slotSpan(s.hours);
        if (!slotDays(s.days).includes(n.wd) || n.hour < a || n.hour >= b) return false;
        return (s.checkins ?? []).some((c) => c.staff === p.id && myt(c.at).key === n.key);
      });
      if (at) return { person: p, geo: postGeo(at), where: `at ${postName(at.location)}`, post: at, metres: null };
      return { person: p, geo: p.post ?? null, where: "at base", metres: null };
    });
}

/** Everyone on duty, nearest first to this camera. */
export function nearestTo(list: Whereabouts[], camera: Camera | undefined, exclude: (string | null | undefined)[] = []): Whereabouts[] {
  const out = list
    .filter((w) => !exclude.includes(w.person.id))
    .map((w) => ({ ...w, metres: w.geo && camera?.geo ? haversineM(w.geo, camera.geo) : null }));
  out.sort(
    (a, b) =>
      (a.metres ?? Infinity) - (b.metres ?? Infinity) ||
      Number(b.person.zone_type === camera?.zone_type) - Number(a.person.zone_type === camera?.zone_type),
  );
  return out;
}

/** "Aiman · at the Block C post · ~10 m" */
export function whereLine(w: Whereabouts): string {
  const m = w.metres != null ? `~${Math.max(10, Math.round(w.metres / 10) * 10)} m` : null;
  return [w.person.first, w.where, m].filter(Boolean).join(" · ");
}
