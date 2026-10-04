import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FactKey, FactValue, StationNarrativeData } from "@/types/narrative";
import { FactCard } from "./FactCard";

/** Bold and italic runs, the only markup the narrative renderer writes. */
const INLINE = /\*\*(.+?)\*\*|\*(.+?)\*/g;
/** A bolded run that is a figure ("2,422", "-24%", "+0.2%") is set in the number face. */
const FIGURE = /^[+-]?[\d.,]+%?$/;

/** A story paragraph as React text: no HTML is injected, so a story can never carry markup. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push(text.slice(last, index));
    const [, bold, italic] = match;
    out.push(
      bold !== undefined ? (
        <strong key={index} className={cn("font-semibold text-ink", FIGURE.test(bold) && "font-mono font-medium tabular")}>
          {bold}
        </strong>
      ) : (
        <em key={index}>{italic}</em>
      ),
    );
    last = index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/**
 * A station's story (R19): the archetype title as a run-in heading, the paragraphs at 15px/1.6,
 * a one-line quality note at most, and the evidence facts as a two-column definition list whose
 * methods open by tap or keyboard. The archetype's emoji and the quality pill are gone.
 */
export function StationStory({
  narrative,
  facts,
}: {
  narrative: StationNarrativeData;
  facts: Partial<Record<FactKey, FactValue & { label?: string }>> | null;
}) {
  const [first = "", ...rest] = narrative.story
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const evidence = narrative.evidenceFactKeys.flatMap((key) => {
    const fact = facts?.[key];
    return fact ? [{ key, fact }] : [];
  });

  return (
    <div>
      <div className="space-y-3 text-15 text-ink">
        <div>
          <h3 className="inline font-semibold">{narrative.archetype.title}.</h3> <p className="inline">{inline(first)}</p>
        </div>
        {rest.map((paragraph, i) => (
          <p key={i}>{inline(paragraph)}</p>
        ))}
      </div>
      {narrative.qualityNote && <p className="mt-3 text-13 text-ink-2">{narrative.qualityNote}</p>}
      {evidence.length > 0 && (
        <>
          <h4 className="mt-5 text-13 font-medium text-ink-2">Evidence</h4>
          <dl className="mt-1 border-t border-rule">
            {evidence.map(({ key, fact }) => (
              <FactCard key={key} factKey={key} fact={fact} />
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
