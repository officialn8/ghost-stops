import path from "node:path";
import { fileURLToPath } from "node:url";

/** True when the module at `moduleUrl` is the script node was asked to run, not an import of it. */
export function isCliEntry(moduleUrl: string): boolean {
    const entry = process.argv[1];
    return entry !== undefined && path.resolve(entry) === fileURLToPath(moduleUrl);
}

/**
 * Stops a database script before it connects anywhere unintended. Prisma 7 no longer reads `.env`,
 * and with no DATABASE_URL the pg driver falls back to its PG* defaults (localhost, the OS user),
 * so a shell that forgot the export would write to whatever Postgres answers there.
 */
export function requireDatabaseUrl(): void {
    if (!process.env.DATABASE_URL) {
        throw new Error(
            "DATABASE_URL must be set; export it in this shell (docs/runbooks/history-load.md section 1).",
        );
    }
}
