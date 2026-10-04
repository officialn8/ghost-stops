import { useId } from "react";
import { cn } from "@/lib/utils";

/** An inline text link: ink, with an underline that darkens on hover. */
export const linkClass = "rounded text-ink underline decoration-ink/40 underline-offset-2 hover:decoration-ink";

/**
 * One dossier section: a hairline, a type-only heading in sentence case, then the content. No
 * boxes; sections are grouped by rules and spacing.
 */
export function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn("mt-8 border-t border-rule pt-4", className)}>
      <h2 id={headingId} className="text-13 font-medium text-ink-2">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * An outlined text chip: a data-quality note, a null component's reason, or the small-station
 * badge (`strong`). Ink border, no fill; long text wraps inside it.
 */
export function Chip({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block rounded border px-2 py-0.5 text-13",
        strong ? "border-ink font-medium text-ink" : "border-ink-2 text-ink",
      )}
    >
      {children}
    </span>
  );
}
