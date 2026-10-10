import type { Status } from "@/lib/types";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusChip({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-[2px] border px-2 text-[12px] font-bold",
        STATUS_STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
