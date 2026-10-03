// Setup file for the `db` Vitest project: runs before any database test file loads.
import { assertLocalDatabaseUrl } from "./db-guard";

assertLocalDatabaseUrl(process.env.DATABASE_URL);
