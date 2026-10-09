import type { ComponentPropsWithoutRef } from "react";

/**
 * The method page's lists: a term over its meaning, with a hairline between entries, as in the
 * dossier's definition lists. A sentence gets the column's whole measure.
 */

/** The element named, on its own line, in the weight the four parts use for their names. */
export function Term({ children }: { children: React.ReactNode }) {
  return <dt className="text-15 font-medium">{children}</dt>;
}

/** Its meaning, a sentence or more at full ink, under the term and across the whole column. */
export function Meaning({ children }: { children: React.ReactNode }) {
  return <dd className="mt-1 text-15">{children}</dd>;
}

/** A number inside a sentence keeps the mono face at the surrounding size (the Mono Numbers Rule). */
export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono tabular text-ink">{children}</span>;
}

/**
 * One entry of a key. The pointer handlers let the row key light the cell an entry explains;
 * elsewhere the entry is inert.
 */
export function KeyRow({
  children,
  ...pointer
}: { children: React.ReactNode } & Pick<ComponentPropsWithoutRef<"div">, "onPointerEnter" | "onPointerLeave">) {
  return (
    <div className="border-b border-rule py-3" {...pointer}>
      {children}
    </div>
  );
}

/** A one-line entry, where the meaning is a phrase: the term in a fixed column, the phrase beside it. */
export function KeyLine({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 border-b border-rule py-3">{children}</div>;
}
