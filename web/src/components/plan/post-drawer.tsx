"use client";

// "+ Add a post" and "Edit": one drawer for both (brief §6.4, finish prompt D13–14).
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { CampusGeoJson } from "@/components/campus3d/model";
import { haversineM } from "@/lib/geo";
import { DAY_SHORT, fit, hh, hoursLabel, type Person, slotDays, slotSpan } from "@/lib/posts";
import type { Camera, GeoPoint, PatrolSlot } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Avatar } from "./avatar";

export interface PostDraft {
  location: string;
  zone_type: string;
  geo: GeoPoint | null;
  days: string;
  hours: string;
  tip: string | null;
  assigned_to: string | null;
}

interface Place {
  key: string;
  label: string;
  location: string;
  zone_type: string;
  geo: GeoPoint | null;
}

/** [1,3] → "Tue, Thu"; [0,1,2,3] → "Mon–Thu"; [6,0,1] → "Sun–Tue". */
export function daysString(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length >= 3) {
    for (const start of d) {
      const run = d.map((_, i) => (start + i) % 7);
      if ([...run].sort((a, b) => a - b).join() === d.join()) return `${DAY_SHORT[run[0]]}–${DAY_SHORT[run[run.length - 1]]}`;
    }
  }
  return d.map((x) => DAY_SHORT[x]).join(", ");
}

const fetchGeo = (u: string) => fetch(u).then((r) => r.json() as Promise<CampusGeoJson>);

export function PostDrawer({
  open,
  onOpenChange,
  slot,
  cameras,
  buildingsUrl,
  people,
  allActive,
  pickedPoint,
  onPickOnMap,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit this post; absent = add a new one. */
  slot: PatrolSlot | null;
  cameras: Camera[];
  buildingsUrl: string;
  people: Person[];
  allActive: PatrolSlot[];
  /** A point picked on the map (map's onPickPoint), offered as a place. */
  pickedPoint?: GeoPoint | null;
  /** Close the drawer and pick the place on the 2D map. */
  onPickOnMap?: () => void;
  onSave: (d: PostDraft) => Promise<boolean>;
}) {
  const { data: geo } = useSWR(open ? buildingsUrl : null, fetchGeo, { revalidateOnFocus: false });
  const places = useMemo<Place[]>(() => {
    const out: Place[] = [];
    const seen = new Set<string>();
    for (const c of cameras) {
      if (seen.has(c.location)) continue;
      seen.add(c.location);
      out.push({ key: `cam:${c.location}`, label: c.location, location: c.location, zone_type: c.zone_type, geo: c.geo ? { lat: c.geo.lat, lng: c.geo.lng } : null });
    }
    for (const f of geo?.features ?? []) {
      if (f.properties.kind !== "building" || !f.properties.name) continue;
      const ring = f.geometry.coordinates[0];
      const lng = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const lat = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      const name = f.properties.name.replace(/ @ .*$/, "");
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ key: `bld:${name}`, label: `${name} (building)`, location: name, zone_type: "building", geo: { lat, lng } });
    }
    if (pickedPoint) {
      // Name the point after the nearest known place.
      const near = out
        .filter((p) => p.geo)
        .map((p) => ({ p, m: haversineM(p.geo!, pickedPoint) }))
        .sort((a, b) => a.m - b.m)[0];
      const name = near ? (near.m < 15 ? near.p.location : `Near ${near.p.location}`) : "Point on the map";
      out.unshift({ key: "pick", label: `${name} (picked on the map)`, location: name, zone_type: near?.p.zone_type ?? "other", geo: pickedPoint });
    }
    return out;
  }, [cameras, geo, pickedPoint]);

  const [placeKey, setPlaceKey] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState(17);
  const [len, setLen] = useState(1);
  const [tip, setTip] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill on open.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (slot) {
      const [a, b] = slotSpan(slot.hours);
      setPlaceKey(places.find((p) => p.location === slot.location)?.key ?? `keep:${slot.location}`);
      setDays(slotDays(slot.days));
      setStart(a);
      setLen(Math.min(3, Math.max(1, b - a)));
      setTip(slot.tip ?? "");
      setWho(slot.assigned_to ?? null);
    } else {
      setPlaceKey(pickedPoint ? "pick" : "");
      setDays([]);
      setStart(17);
      setLen(1);
      setTip("");
      setWho(null);
    }
    // places load a moment later; prefill once per open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slot?.id]);

  const place =
    places.find((p) => p.key === placeKey) ??
    (slot && placeKey === `keep:${slot.location}`
      ? { key: placeKey, label: slot.location, location: slot.location, zone_type: slot.zone_type ?? "other", geo: slot.geo ?? null }
      : null);
  const draftSlot: PatrolSlot = {
    ...(slot ?? { incidents_4w: 0, expected_avoided_per_week: 0, rationale: "" }),
    id: slot?.id ?? "__new",
    location: place?.location ?? "",
    days: daysString(days),
    hours: hoursLabel(start, len),
    status: "active",
  } as PatrolSlot;
  const fitOf = (p: Person) => fit(p, draftSlot, allActive);
  const chosen = people.find((p) => p.id === who) ?? null;
  const chosenFit = chosen ? fitOf(chosen) : null;
  const ready = !!place && days.length > 0;

  const save = async () => {
    if (!place || !days.length) return;
    setSaving(true);
    setError(null);
    const ok = await onSave({
      location: place.location,
      zone_type: place.zone_type,
      geo: place.geo,
      days: draftSlot.days,
      hours: draftSlot.hours,
      tip: tip.trim() || null,
      assigned_to: who,
    });
    setSaving(false);
    if (ok) onOpenChange(false);
    else setError("Couldn't save that. Try again.");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="max-w-full gap-0 overflow-y-auto rounded-none border-line bg-white p-0 shadow-none transition-none data-[side=right]:w-full data-[side=right]:sm:w-[520px] data-[side=right]:sm:max-w-[520px]"
      >
        <div className="flex flex-col gap-4 p-5">
          <SheetTitle className="ee-display text-[32px] leading-none">{slot ? "Edit this post" : "Add a post"}</SheetTitle>
          <SheetDescription className="text-[15px] text-ink-2">
            {slot
              ? "Changes go straight to the guard's app, which asks them to look again."
              : "A standing post, like the ones EarlyEye suggests. It stays until you end it."}
          </SheetDescription>

          <label className="flex flex-col gap-1.5">
            <span className="ee-label">Where</span>
            <select value={placeKey} onChange={(e) => setPlaceKey(e.target.value)} className="min-h-11 rounded-[2px] border border-line-strong bg-white px-2.5 text-[16px]">
              <option value="">Pick a place…</option>
              {slot && placeKey === `keep:${slot.location}` && <option value={placeKey}>{slot.location}</option>}
              {places.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
            {onPickOnMap && !slot && (
              <button type="button" onClick={onPickOnMap} className="min-h-10 self-start rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold">
                {pickedPoint ? "Pick another point on the map" : "Pick a point on the map"}
              </button>
            )}
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="ee-label mb-1.5">Days</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAY_SHORT.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i])} className={cn("min-h-11 min-w-12 rounded-[2px] border px-2.5 text-[15px] font-bold", on ? "border-ink bg-ink text-white" : "border-line-strong bg-white")}>
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="ee-label">Starts</span>
              <select value={start} onChange={(e) => setStart(parseInt(e.target.value))} className="min-h-11 rounded-[2px] border border-line-strong bg-white px-2.5 font-mono text-[16px]">
                {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="ee-label mb-1.5">For</legend>
              <div className="inline-flex overflow-hidden rounded-[2px] border border-line-strong">
                {[1, 2, 3].map((l) => (
                  <button key={l} type="button" aria-pressed={len === l} onClick={() => setLen(l)} className={cn("min-h-11 px-3.5 text-[15px] font-bold", l > 1 && "border-l border-line-strong", len === l ? "bg-ink text-white" : "bg-white")}>
                    {l} h
                  </button>
                ))}
              </div>
            </fieldset>
            <span className="self-end pb-2.5 font-mono text-[15px] font-bold">{hoursLabel(start, len)}</span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="ee-label">Tip for the guard (optional)</span>
            <textarea value={tip} onChange={(e) => setTip(e.target.value)} rows={2} placeholder="Where to stand, what to watch." className="rounded-[2px] border border-line-strong px-2.5 py-2 text-[15px]" />
          </label>

          <div className="flex flex-col gap-1.5" role="group" aria-label="Who goes">
            <span className="ee-label">Who goes</span>
            {slot && chosen && chosenFit && !chosenFit.ok && (
              <p className="m-0 rounded-[2px] border-2 border-dashed border-ink px-3 py-2 text-[14px] font-bold">
                {chosen.name} isn&rsquo;t free then: {chosenFit.note}. Pick someone else below, or save and sort it out later.
              </p>
            )}
            {people.map((p) => {
              const f = p.id === who ? { ok: true, note: chosenFit?.ok === false ? chosenFit.note : "Going" } : fitOf(p);
              const free = f.ok || p.id === who;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={p.id === who}
                  aria-disabled={!free}
                  onClick={() => free && setWho(p.id === who ? null : p.id)}
                  className={cn(
                    "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] border bg-white py-1.5 pr-3 pl-1.5 text-left text-[15px]",
                    p.id === who ? "border-2 border-signal" : free ? "border-ink" : "cursor-not-allowed border-line text-muted-ink opacity-60",
                  )}
                >
                  <Avatar person={p} size={34} />
                  <span className="min-w-[120px] font-extrabold">{p.name}</span>
                  <span className="text-[13px]">{p.id === who ? (chosenFit?.ok === false ? `Chosen · ${chosenFit.note}` : "Chosen") : f.note}</span>
                </button>
              );
            })}
            <button type="button" aria-pressed={who == null} onClick={() => setWho(null)} className={cn("flex min-h-12 items-center gap-3 rounded-[2px] border bg-white py-1.5 pr-3 pl-1.5 text-left text-[15px]", who == null ? "border-2 border-signal" : "border-line-strong")}>
              <Avatar person={null} size={34} />
              <span className="font-extrabold">Nobody yet</span>
            </button>
          </div>

          {error && <p role="alert" className="m-0 text-[15px] font-bold">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!ready || saving} onClick={save} className="min-h-12 rounded-[2px] bg-signal px-5 text-[16px] font-extrabold text-white disabled:bg-line-strong">
              {saving ? "Saving…" : slot ? "Save changes" : "Add this post"}
            </button>
            <button type="button" onClick={() => onOpenChange(false)} className="min-h-12 rounded-[2px] border border-line-strong bg-white px-4 text-[15px] font-bold">
              Cancel
            </button>
          </div>
          {!ready && <span className="text-[13px] text-muted-ink">Pick a place and at least one day.</span>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
