import Link from "next/link";

/**
 * Where the compact 3D campus goes on the Live card (brief §9). The deck.gl view
 * lands on web/campus-3d; until then this shows the WHERE line on a quiet panel.
 */
export function CampusCompactSlot({
  cameraId,
  whereText,
}: {
  cameraId?: string;
  whereText: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative flex h-[180px] items-end rounded-[2px] border border-dashed border-line-strong bg-raised p-2.5"
        aria-label={`Campus map: ${whereText}`}
        role="img"
      >
        <span className="font-mono text-[11px] font-bold tracking-[0.06em] text-ink">
          {whereText}
        </span>
        <span className="absolute right-2.5 top-2.5 font-mono text-[11px] text-muted-ink">
          3D CAMPUS
        </span>
      </div>
      {cameraId && (
        <Link
          href={`/cameras?cam=${encodeURIComponent(cameraId)}`}
          className="text-[13px] font-bold text-signal"
        >
          Open the 3D campus
        </Link>
      )}
    </div>
  );
}
