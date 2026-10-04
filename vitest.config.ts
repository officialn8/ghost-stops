import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json. Projects inherit it via `extends: true`.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Keep include/exclude out of this root block: `extends: true` merges it into
    // each project, and Vite's config merge concatenates arrays.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          // React components, rendered into jsdom with Testing Library.
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/dom-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.{ts,tsx}"],
          // Refuses any DATABASE_URL that is unset or not local, before a test can write to it.
          setupFiles: ["./src/test/db-setup.ts"],
          // All database test files share one Postgres database, so run them one file at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
