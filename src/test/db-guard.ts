const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Database tests write to the database they run against, so they may only target a
 * local or CI Postgres. Throws when DATABASE_URL is unset (Prisma would silently read
 * .env instead) or points at any other host. Never echoes the URL, which may hold a password.
 */
export function assertLocalDatabaseUrl(url: string | undefined): void {
    if (!url) {
        throw new Error(
            "DATABASE_URL must be set explicitly for database tests, or Prisma falls back to .env.",
        );
    }

    let host: string;
    try {
        host = new URL(url).hostname;
    } catch {
        throw new Error("DATABASE_URL is not a valid URL.");
    }

    if (!LOCAL_HOSTS.has(host)) {
        throw new Error(
            `Refusing to run database tests against ${host}. Point DATABASE_URL at a local or CI Postgres.`,
        );
    }
}
