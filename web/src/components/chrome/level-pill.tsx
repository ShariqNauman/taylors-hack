import type { Level } from "@/lib/types";
import { LEVEL_LABEL, LEVEL_THEME } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LevelGlyph } from "./level-glyph";

/**
 * Level = glyph + word + colour. `size` "xl" is the 48 px Saira pill on the Live
 * card; "md" is a queue / tile chip; "sm" is a table chip.
 */
export function LevelPill({
  level,
  size = "md",
  className,
}: {
  level: Level;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const t = LEVEL_THEME[level];
  const dims = {
    sm: {
      glyph: 11,
      cls: "gap-1.5 px-2 py-0.5 text-[12px] font-extrabold uppercase border",
    },
    md: {
      glyph: 12,
      cls: "gap-1.5 px-2 py-0.5 text-[13px] font-extrabold uppercase border",
    },
    lg: {
      glyph: 22,
      cls: "ee-display gap-2.5 px-4 py-1.5 text-[32px] border-2",
    },
    xl: {
      glyph: 30,
      cls: "ee-display gap-3 pl-3.5 pr-5 py-2 text-[48px] border-2",
    },
  }[size];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] leading-none transition-colors duration-300",
        dims.cls,
        className,
      )}
      style={{
        background: t.pillBg,
        color: t.pillFg,
        borderColor: t.pillBorder,
      }}
    >
      <LevelGlyph level={level} size={dims.glyph} fill={t.pillFg} />
      {LEVEL_LABEL[level]}
    </span>
  );
}
