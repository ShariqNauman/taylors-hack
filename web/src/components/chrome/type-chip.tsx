import { CircleDot, Users, UsersRound, Zap } from "lucide-react";
import type { IncidentType } from "@/lib/types";
import { TYPE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

const ICON = {
  fight: Zap,
  cornering: Users,
  crowd: UsersRound,
  play: CircleDot,
} as const;

/** Type = icon + word. Outlined ink, never coloured. */
export function TypeChip({
  type,
  size = "md",
  className,
}: {
  type: IncidentType;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Icon = ICON[type];
  const cls = {
    sm: "min-h-6 gap-1 px-1.5 text-[12px] font-bold border",
    md: "min-h-7 gap-1.5 px-2 text-[13px] font-bold border",
    lg: "min-h-10 gap-2 px-3 text-[18px] font-extrabold border-2",
  }[size];
  const icon = { sm: 12, md: 14, lg: 20 }[size];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border-ink bg-white text-ink",
        cls,
        className,
      )}
    >
      <Icon size={icon} strokeWidth={2} aria-hidden />
      {TYPE_LABEL[type]}
    </span>
  );
}
