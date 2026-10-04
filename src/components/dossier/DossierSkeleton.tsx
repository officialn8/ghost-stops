import { BackToMap, CloseDrawer } from "./CloseControls";

/** The dossier's shape while a station page loads: the header, the number, then the sections. */
export function DossierSkeleton() {
  return (
    <div className="px-5 pb-10 pt-3" aria-busy="true" aria-label="Loading station">
      <div className="flex h-10 items-center justify-between">
        <BackToMap />
        <span className="ml-auto">
          <CloseDrawer />
        </span>
      </div>
      <div aria-hidden>
        <div className="mt-3 h-9 w-2/3 rounded bg-ink/[.08]" />
        <div className="mt-3 flex gap-1">
          <span className="h-1 w-8 bg-ink/[.08]" />
          <span className="h-1 w-8 bg-ink/[.08]" />
        </div>
        <div className="mt-8 h-14 w-1/2 rounded bg-ink/[.08]" />
        <div className="mt-8 space-y-3">
          {[78, 64, 70].map((w) => (
            <div key={w} className="h-4 rounded bg-ink/[.08]" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="mt-10 h-40 rounded bg-ink/[.06]" />
      </div>
    </div>
  );
}
