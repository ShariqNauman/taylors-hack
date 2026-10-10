import type { Level } from "@/lib/types";
import { LEVEL_GLYPH } from "@/lib/format";

export function LevelGlyph({
  level,
  size = 24,
  fill = "currentColor",
  className,
}: {
  level: Level;
  size?: number;
  fill?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path d={LEVEL_GLYPH[level]} fill={fill} />
    </svg>
  );
}
