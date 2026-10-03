import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The repo root, named explicitly: a package-lock.json in a parent directory would otherwise
// make Next infer that directory as the workspace root for file tracing and Turbopack.
const root = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: root,
  turbopack: {
    root,
  },
  images: {
    unoptimized: true
  }
};

export default nextConfig;
