import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Server-only modules that UI components must never import. Patterns use gitignore
// semantics: `**/` matches the `@/` alias and relative `../` imports, a match on a path
// also covers everything beneath it, and `.*` catches explicit extensions.
const serverOnly = (modulePath, role) => ({
  group: [`**/${modulePath}`, `**/${modulePath}.*`],
  message: `src/${modulePath} is server-only (${role}). Components must get this data from an API route instead.`,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            serverOnly("lib/sync", "data sync"),
            serverOnly("lib/scoring", "score computation"),
            serverOnly("lib/narratives/generate", "narrative generation"),
            serverOnly("lib/prisma", "database client"),
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
