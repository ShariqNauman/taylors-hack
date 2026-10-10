import type { Level, TopFeature } from "@/lib/types";
import { LEVEL_THEME } from "@/lib/format";
import { FEATURE_LABEL } from "@/lib/mock-poses";

/** Up to four meters from `top_features`. Hidden when the field is absent (brief §8.3). */
export function FeatureMeters({
  features,
  level,
}: {
  features?: TopFeature[];
  level: Level;
}) {
  if (!features?.length) return null;
  const theme = LEVEL_THEME[level];
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
      {features.slice(0, 4).map((f) => {
        const meta = FEATURE_LABEL[f.name] ?? {
          label: f.name.replace(/_/g, " ").toUpperCase(),
          note: "Model feature",
          max: 1,
        };
        const r = Math.max(0, Math.min(1, f.value / meta.max));
        const hot = r >= 0.6;
        const value = meta.unit
          ? `${f.value.toFixed(1)}${meta.unit}`
          : meta.max > 1
            ? String(Math.round(f.value))
            : f.value.toFixed(2);
        const note =
          f.name === "risk_score"
            ? f.value >= 0.55
              ? "Above the alarm line"
              : f.value >= 0.5
                ? "Above the tense line"
                : "Below the tense line"
            : meta.note;
        return (
          <div
            key={f.name}
            className="flex flex-col gap-1.5 rounded-[2px] border bg-raised px-3 py-2.5"
            style={{ borderColor: hot ? theme.border : "#DCDFE4" }}
          >
            <span className="ee-label">{meta.label}</span>
            <span className="font-mono text-[22px] font-bold leading-none">
              {value}
            </span>
            <span className="relative h-1.5 rounded-[1px] bg-line" aria-hidden>
              <span
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${Math.round(r * 100)}%`,
                  background: hot ? theme.cell : "#8B939E",
                }}
              />
            </span>
            <span className="text-[12px] text-ink-2">{note}</span>
          </div>
        );
      })}
    </div>
  );
}
