import { linesLabel } from "@/lib/format";
import { cn, getLineColor } from "@/lib/utils";

/**
 * The lines a station serves, as short bars in the official CTA colors, like the colored stripes
 * on a platform sign (R23). The line names are given as an accessible label; pass `decorative`
 * when the names are already written out nearby.
 */
export function LineBars({
  lines,
  className,
  barClassName = "h-[3px] w-5",
  decorative = false,
}: {
  lines: readonly string[];
  className?: string;
  barClassName?: string;
  decorative?: boolean;
}) {
  if (lines.length === 0) return null;
  const label = linesLabel(lines);
  return (
    <span
      className={cn("flex items-center gap-[3px]", className)}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      {lines.map((line) => (
        <span key={line} className={cn("block shrink-0", barClassName)} style={{ backgroundColor: getLineColor(line) }} />
      ))}
    </span>
  );
}
