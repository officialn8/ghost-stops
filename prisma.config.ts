import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (migrate, diff, validate, generate).
 *
 * The CLI connects over the direct (unpooled) host, because migrations need a session that
 * PgBouncer's transaction mode cannot give them. The app never reads this file: at runtime
 * src/lib/prisma.ts hands the pooled DATABASE_URL to the pg adapter.
 *
 * `process.env` rather than Prisma's `env()` helper, which throws when the variable is unset:
 * `prisma generate` needs no database, so CI's type-check job and the Vercel build must not
 * fail for want of one. A migrate or diff command without the variable fails on its own.
 *
 * Prisma 7 no longer loads `.env`, and this file deliberately does not either: the repo's
 * `.env` still points DATABASE_URL at the old SQLite file. Export both variables in the shell
 * that runs a command (docs/runbooks/history-load.md section 1).
 */
export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
    },
    datasource: {
        url: process.env.DATABASE_URL_UNPOOLED,
    },
});
