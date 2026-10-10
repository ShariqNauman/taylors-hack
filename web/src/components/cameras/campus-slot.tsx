/** Where the full 3D campus goes (brief §9). Replaced by <Campus3D> when web/campus-3d lands. */
export function CampusSlot({
  height = 520,
  caption,
}: {
  height?: number;
  caption: string;
}) {
  return (
    <div
      className="flex items-end rounded-[2px] border border-dashed border-line-strong bg-raised p-3"
      style={{ height }}
      role="img"
      aria-label="3D campus placeholder"
    >
      <span className="font-mono text-[11px] font-bold tracking-[0.06em] text-muted-ink">
        {caption}
      </span>
    </div>
  );
}
