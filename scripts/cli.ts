import path from "node:path";
import { fileURLToPath } from "node:url";

/** True when the module at `moduleUrl` is the script node was asked to run, not an import of it. */
export function isCliEntry(moduleUrl: string): boolean {
    const entry = process.argv[1];
    return entry !== undefined && path.resolve(entry) === fileURLToPath(moduleUrl);
}
