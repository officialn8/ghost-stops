import { BackToMap, CloseDrawer } from "./CloseControls";

const block = "bg-ink/[.08]";

function SectionShape({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 border-t border-rule pt-4">
      <div className={`h-4 rounded ${block}`} style={{ width: heading }} />
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * The dossier's shape while a station page loads, section for section: the sign header and the
 * number, the baselines, the why card's score and rows, the chart, and the two rows along the
 * line. Static blocks, no shimmer (R29).
 */
export function DossierSkeleton() {
  return (
    <div className="px-5 pb-16" aria-busy="true" aria-label="Loading station">
      <div className="flex h-14 items-center justify-between">
        <BackToMap />
        <span className="ml-auto">
          <CloseDrawer />
        </span>
      </div>
      <div aria-hidden>
        <div className={`h-9 w-2/3 rounded ${block}`} />
        <div className="mt-3 flex items-center gap-[3px]">
          <span className={`h-1 w-8 ${block}`} />
          <span className={`ml-2 h-3 w-20 rounded ${block}`} />
        </div>
        <div className="mt-6 flex items-end gap-6">
          <div className={`h-14 w-36 rounded ${block}`} />
          <div className="space-y-2 pb-1.5">
            <div className={`h-5 w-20 rounded ${block}`} />
            <div className={`h-3 w-28 rounded ${block}`} />
          </div>
        </div>
        <div className={`mt-2 h-3 w-3/4 rounded ${block}`} />

        <SectionShape heading="7.5rem">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between border-b border-rule py-3 last:border-b-0">
              <div className={`h-4 w-32 rounded ${block}`} />
              <div className={`h-4 w-24 rounded ${block}`} />
            </div>
          ))}
        </SectionShape>

        <SectionShape heading="7rem">
          <div className={`h-9 w-24 rounded ${block}`} />
          <div className="mt-6">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="space-y-2 border-b border-rule py-3">
                <div className="flex justify-between">
                  <div className={`h-4 w-36 rounded ${block}`} />
                  <div className={`h-4 w-16 rounded ${block}`} />
                </div>
                <div className={`h-3 w-4/5 rounded ${block}`} />
              </div>
            ))}
          </div>
        </SectionShape>

        <SectionShape heading="5.5rem">
          <div className={`h-[140px] ${block}`} />
        </SectionShape>

        <SectionShape heading="8rem">
          {[0, 1].map((row) => (
            <div key={row} className="flex min-h-16 items-center gap-3 border-b border-rule py-3">
              <span className={`h-9 w-1 ${block}`} />
              <div className="flex-1 space-y-2">
                <div className={`h-3 w-20 rounded ${block}`} />
                <div className={`h-4 w-32 rounded ${block}`} />
              </div>
            </div>
          ))}
        </SectionShape>
      </div>
    </div>
  );
}
