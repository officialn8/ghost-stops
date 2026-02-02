import type { IngestionResult } from "../types";
import { refreshDataSource } from "../utils";

export async function runCtaHistoricalIngestion(): Promise<IngestionResult> {
  const result = await refreshDataSource("cta_socrata");
  result.warnings.push(
    "CTA historical ingestion is not implemented yet. Add extended ridership pulls here."
  );
  return result;
}
