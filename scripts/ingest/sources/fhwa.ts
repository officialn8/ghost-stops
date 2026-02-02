import type { IngestionResult } from "../types";
import { refreshDataSource } from "../utils";

export async function runFhwaIngestion(): Promise<IngestionResult> {
  const result = await refreshDataSource("fhwa");
  result.warnings.push(
    "FHWA ingestion is not implemented yet. Add highway statistics ingestion here."
  );
  return result;
}
