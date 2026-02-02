export type IngestionResult = {
  sourceCode: string;
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
  errors: string[];
};
