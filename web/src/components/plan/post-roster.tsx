"use client";

// Section 2, "Who is going?": the team, one row per post, and the chooser.
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  dayDate,
  daysLabel,
  fit,
  hm,
  onShift,
  type Person,
  slotKey,
  suggestPerson,
} from "@/lib/posts";
import type { PatrolSlot } from "@/lib/types";
import { Avatar } from "./avatar";

export interface RosterPost {
  slot: PatrolSlot;
  rank: number;
}

export function TeamStrip({ people, now }: { people: Person[]; now: number }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="The team">
      {people.map((p) => {
        const on = onShift(p, now);
        return (
          <li key={p.id} className="flex items-center gap-2 rounded-full border border-line bg-white py-1.5 pr-3 pl-1.5">
            <Avatar person={p} size={36} />
            <span className="flex flex-col">
              <span className="text-[14px] font-extrabold">{p.name}</span>
              <span className={cn("text-[12px] font-bold", on ? "text-signal-ink" : "text-muted-ink")}>
                {on ? "On duty now" : "Off duty"} · {p.id}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PostRow({
  post,
  people,
  allActive,
  selected,
  onSelect,
  onAssign,
  onEnd,
  busy,
}: {
  post: RosterPost;
  people: Person[];
  allActive: PatrolSlot[];
  selected: boolean;
  onSelect: () => void;
  onAssign: (who: string | null) => void;
  onEnd: () => void;
  busy: boolean;
}) {
  const { slot, rank } = post;
  const [choosing, setChoosing] = useState(false);
  const g = people.find((p) => p.id === slot.assigned_to) ?? null;
  const sug = g ? null : suggestPerson(people, slot, allActive);
  const since = slot.since ? `standing post since ${dayDate(slot.since)}` : "standing post";
  const pick = (who: string | null) => {
    setChoosing(false);
    onAssign(who);
  };
  const changeLabel = choosing ? "Cancel" : g ? "Change" : "Someone else";

  return (
    <article
      id={`post-${slotKey(slot)}`}
      className={cn(
        "flex scroll-mt-24 flex-col gap-2.5 rounded-[2px] p-3.5",
        g ? "border border-line" : "border-2 border-dashed border-ink",
        selected && "outline outline-2 outline-offset-2 outline-signal",
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex items-start gap-3 text-left">
        <span className="ee-display inline-flex size-[38px] flex-none items-center justify-center rounded-full bg-signal text-[22px] text-white">
          {rank}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[20px] leading-tight font-extrabold">{slot.location}</span>
          <span className="text-[16px] text-ink-2">
            <span className="font-extrabold text-ink">{daysLabel(slot.days)}</span> · {slot.hours} · {since}
          </span>
        </span>
      </button>

      {!choosing && g && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2.5">
            <Avatar person={g} size={44} />
            <span className="flex flex-col">
              <span className="text-[16px] font-extrabold">{g.name}</span>
              <span className="text-[13px] text-muted-ink">{g.id} · {g.shiftLabel}</span>
            </span>
          </span>
          <span className={cn("inline-flex flex-[1_1_170px] items-center gap-1.5 text-[14px] font-bold", slot.seen_at ? "text-ink" : "text-muted-ink")}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {slot.seen_at ? `Seen in the app · ${dayDate(slot.seen_at)}, ${hm(slot.seen_at)}` : "Sent to the app, not seen yet"}
          </span>
          <button type="button" disabled={busy} onClick={() => setChoosing(true)} className="min-h-10 rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold">
            {changeLabel}
          </button>
        </div>
      )}

      {!choosing && !g && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex min-h-[42px] items-center rounded-full border-2 border-dashed border-ink px-3.5 text-[15px] font-extrabold">Nobody yet</span>
          <button
            type="button"
            disabled={!sug || busy}
            onClick={() => sug && pick(sug.id)}
            className="min-h-11 rounded-[2px] bg-ink px-4 text-[15px] font-extrabold text-white disabled:bg-line-strong"
          >
            {sug ? `Send ${sug.first}` : "Nobody is free"}
          </button>
          <button type="button" disabled={busy} onClick={() => setChoosing(true)} className="min-h-10 rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold">
            {changeLabel}
          </button>
          <span className="basis-full text-[13px] text-muted-ink">
            {sug ? `${sug.name} is on shift then${sug.zone_type === slot.zone_type ? " and already works nearby." : "."}` : "Nobody on the team works at that time."}
          </span>
        </div>
      )}

      {choosing && (
        <div className="flex flex-col gap-1.5" role="group" aria-label={`Who goes to post ${rank}`}>
          {people.map((p) => {
            const f = g && p.id === g.id ? { ok: true, note: "Going now" } : fit(p, slot, allActive);
            return (
              <button
                key={p.id}
                type="button"
                aria-disabled={!f.ok}
                onClick={() => f.ok && pick(p.id)}
                className={cn(
                  "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[2px] border bg-white py-1.5 pr-3 pl-1.5 text-left text-[15px]",
                  f.ok ? "border-ink text-ink" : "cursor-not-allowed border-line text-muted-ink opacity-60",
                )}
              >
                <Avatar person={p} size={34} />
                <span className="min-w-[120px] font-extrabold">{p.name}</span>
                <span className="text-[13px]">{f.note}</span>
              </button>
            );
          })}
          {g && (
            <button type="button" onClick={() => pick(null)} className="flex min-h-12 flex-wrap items-center gap-x-3 rounded-[2px] border border-line-strong bg-white py-1.5 pr-3 pl-1.5 text-left text-[15px]">
              <Avatar person={null} size={34} />
              <span className="min-w-[120px] font-extrabold">Nobody</span>
              <span className="text-[13px]">Take this post off their phone</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setChoosing(false);
              onEnd();
            }}
            className="flex min-h-12 flex-wrap items-center gap-x-3 rounded-[2px] border border-line-strong bg-white py-1.5 pr-3 pl-1.5 text-left text-[15px]"
          >
            <Avatar person={null} size={34} />
            <span className="min-w-[120px] font-extrabold">End this post</span>
            <span className="text-[13px]">It stops for everyone. EarlyEye will suggest it again if trouble comes back.</span>
          </button>
          <button type="button" onClick={() => setChoosing(false)} className="min-h-10 self-start rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold">
            Cancel
          </button>
        </div>
      )}
    </article>
  );
}
