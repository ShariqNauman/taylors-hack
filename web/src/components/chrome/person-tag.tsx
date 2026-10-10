"use client";

import useSWR from "swr";
import { getSite } from "@/lib/api";
import { team, type Person } from "@/lib/posts";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/plan/avatar";

/** Picture, display name, and the call sign small. Falls back to the call sign alone. */
export function PersonTag({
  person,
  call,
  size = 32,
  dark,
  sub,
  className,
}: {
  person: Person | null;
  call?: string | null;
  size?: number;
  dark?: boolean;
  sub?: string | null;
  className?: string;
}) {
  const name = person?.name ?? call ?? "Person on duty";
  const id = person?.id ?? call;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Avatar person={person ?? (call ? fallback(call) : null)} size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-extrabold">
          <span className="min-w-0 break-words">{name}</span>
          {person && id && <span className={cn("font-mono text-[11px] font-bold whitespace-nowrap uppercase", dark ? "text-white/75" : "text-muted-ink")}>{id}</span>}
        </span>
        {sub && <span className={cn("text-[13px] font-medium", dark ? "text-white/85" : "text-ink-2")}>{sub}</span>}
      </span>
    </span>
  );
}

const fallback = (call: string): Person => ({
  id: call, name: call, first: call, role: "", shiftLabel: "", days: [], from: 0, to: 24, zone_type: "", onDuty: null,
});

/** Same, looked up by call sign from GET /site (for the banner and the toast). */
export function PersonByCall({ call, ...rest }: { call: string } & Omit<Parameters<typeof PersonTag>[0], "person" | "call">) {
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const person = team(site?.staff).find((p) => p.id === call) ?? null;
  return <PersonTag person={person} call={call} {...rest} />;
}
