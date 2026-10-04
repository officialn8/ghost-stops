"use client";

import { DossierError } from "@/components/dossier/DossierError";

/** A station page that failed to load: an inline message with a retry, inside the drawer (KTD12). */
export default function StationError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DossierError reset={reset} />;
}
