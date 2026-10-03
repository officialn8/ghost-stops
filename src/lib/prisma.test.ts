import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

// Count constructions across module re-evaluations, and keep what each one was given.
const constructed = vi.hoisted(() => ({
    count: 0,
    pools: [] as unknown[],
    poolConfigs: [] as Record<string, unknown>[],
    attached: [] as unknown[],
    adapters: [] as { pool: unknown; options: unknown }[],
    clientOptions: [] as { adapter?: unknown }[],
}));

vi.mock("@/generated/prisma/client", () => ({
    PrismaClient: vi.fn(function PrismaClient(this: object, options: { adapter?: unknown }) {
        constructed.count += 1;
        constructed.clientOptions.push(options);
    }),
}));

vi.mock("pg", () => ({
    Pool: vi.fn(function Pool(this: object, config: Record<string, unknown>) {
        constructed.pools.push(this);
        constructed.poolConfigs.push(config);
    }),
}));

vi.mock("@prisma/adapter-pg", () => ({
    PrismaPg: vi.fn(function PrismaPg(this: { pool?: unknown }, pool: unknown, options: unknown) {
        this.pool = pool;
        constructed.adapters.push({ pool, options });
    }),
}));

vi.mock("@vercel/functions", () => ({
    attachDatabasePool: vi.fn((pool: unknown) => {
        constructed.attached.push(pool);
    }),
}));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

/** Forgets the cached client and every recorded construction, so the next import starts fresh. */
function resetClientModule() {
    delete globalForPrisma.prisma;
    constructed.count = 0;
    for (const list of [constructed.pools, constructed.poolConfigs, constructed.attached, constructed.adapters, constructed.clientOptions]) {
        list.length = 0;
    }
    vi.unstubAllEnvs();
    vi.resetModules();
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const srcDir = join(repoRoot, "src");
/** The one module allowed to construct the client. */
const clientModule = fileURLToPath(new URL("./prisma.ts", import.meta.url));

const liveRouteHandlers = [
    "app/api/chicago/stations/route.ts",
    "app/api/chicago/stations-raw/route.ts",
    "app/api/chicago/stations/[slug]/route.ts",
].map((path) => join(srcDir, path));

const parse = (file: string, source: string) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
const display = (file: string) => relative(repoRoot, file);

/** Tests and the src/test helpers they share may use the client freely: the db tests disconnect it. */
const isTestCode = (file: string) => /\.test\.tsx?$/.test(file) || relative(srcDir, file).startsWith(`test${sep}`);

/** The client `prisma generate` writes; it defines `$disconnect` and `PrismaClient` itself. */
const isGeneratedCode = (file: string) => relative(srcDir, file).startsWith(`generated${sep}`);

/**
 * Every non-test source file under src/ we write, so a helper outside the route handlers
 * cannot hide a violation. Each file is read once.
 */
const serverSource = readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !isTestCode(file) && !isGeneratedCode(file))
    .map((file) => ({ file, ast: parse(file, readFileSync(file, "utf8")) }));

/**
 * True when any node under `root` passes `test`. Comments are not visited as nodes, so prose
 * that mentions the client (as the doc comment in src/lib/prisma.ts does) never matches.
 */
function someNode(root: ts.Node, test: (node: ts.Node) => boolean): boolean {
    const visit = (node: ts.Node): boolean => test(node) || Boolean(ts.forEachChild(node, visit));
    return visit(root);
}

/** Any identifier or string that mentions `$disconnect`: a call, element access, destructuring. */
const mentionsDisconnect = (ast: ts.SourceFile) =>
    someNode(
        ast,
        (node) => (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text.includes("$disconnect"),
    );

const calleeName = (callee: ts.Expression) =>
    ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;

/** Any `new PrismaClient(...)` or `new namespace.PrismaClient(...)`. */
const constructsPrismaClient = (ast: ts.SourceFile) =>
    someNode(ast, (node) => ts.isNewExpression(node) && calleeName(node.expression) === "PrismaClient");

describe("prisma singleton", () => {
    afterEach(resetClientModule);

    it("returns the same client when the module is evaluated twice", async () => {
        const first = await import("./prisma");
        vi.resetModules(); // a second bundle chunk or a dev reload re-evaluates the module
        const second = await import("./prisma");

        expect(second.prisma).toBe(first.prisma);
        expect(constructed.count).toBe(1);
    });

    it("reuses a client already cached on globalThis", async () => {
        const cached = { cached: true };
        globalForPrisma.prisma = cached;

        const { prisma } = await import("./prisma");

        expect(prisma).toBe(cached);
        expect(constructed.count).toBe(0);
        expect(constructed.pools).toEqual([]); // no pool is opened beside the cached client
    });
});

describe("prisma connection", () => {
    afterEach(resetClientModule);

    it("opens one pool on the pooled DATABASE_URL, with an explicit size and connection timeout", async () => {
        vi.stubEnv("DATABASE_URL", "postgresql://app@pooled.example/db");
        vi.stubEnv("DATABASE_URL_UNPOOLED", "postgresql://owner@direct.example/db");

        await import("./prisma");

        expect(constructed.poolConfigs).toHaveLength(1);
        const [config] = constructed.poolConfigs;
        expect(config.connectionString).toBe("postgresql://app@pooled.example/db");
        // pg waits forever when connectionTimeoutMillis is 0 or absent, which hangs on a cold compute.
        expect(config.connectionTimeoutMillis).toBeGreaterThan(0);
        expect(config.max).toBeGreaterThan(0);
        expect(config.idleTimeoutMillis).toBeGreaterThan(0);
    });

    it("attaches the pool to Fluid compute and hands the same pool to the client through the pg adapter", async () => {
        await import("./prisma");

        // Identity, not equality: the mocked pools are empty objects, so toEqual would accept any.
        const [pool] = constructed.pools;
        expect(constructed.attached).toHaveLength(1);
        expect(constructed.attached[0]).toBe(pool);
        expect(constructed.adapters).toHaveLength(1);
        expect(constructed.adapters[0].pool).toBe(pool);
        expect(constructed.clientOptions).toHaveLength(1);
        expect((constructed.clientOptions[0].adapter as { pool?: unknown }).pool).toBe(pool);
    });

    it("asks pg for verify-full by name when Neon's URL says sslmode=require", async () => {
        vi.stubEnv("DATABASE_URL", "postgresql://app@pooled.example/db?sslmode=require&channel_binding=require");

        await import("./prisma");

        expect(constructed.poolConfigs[0].connectionString).toBe(
            "postgresql://app@pooled.example/db?sslmode=verify-full&channel_binding=require",
        );
    });

    it("closes the pool when a script disconnects, so the process can exit", async () => {
        await import("./prisma");

        expect(constructed.adapters[0].options).toEqual({ disposeExternalPool: true });
    });
});

describe("server source", () => {
    it("includes the live route handlers and the client module, so the scan cannot silently find nothing", () => {
        const scanned = serverSource.map(({ file }) => file);
        const missing = [...liveRouteHandlers, clientModule].filter((file) => !scanned.includes(file));
        expect(missing.map(display)).toEqual([]);
    });

    it("never disconnects the shared client", () => {
        const offenders = serverSource
            .filter(({ ast }) => mentionsDisconnect(ast))
            .map(({ file }) => display(file));
        expect(offenders).toEqual([]);
    });

    it("never constructs its own PrismaClient outside src/lib/prisma.ts", () => {
        const offenders = serverSource
            .filter(({ file, ast }) => file !== clientModule && constructsPrismaClient(ast))
            .map(({ file }) => display(file));
        expect(offenders).toEqual([]);
    });
});

// The scan above only means something if the detectors fire, so pin down what they match.
describe("guard detection", () => {
    const snippet = (code: string) => parse("snippet.ts", code);

    it.each([
        ["a call", "await client.$disconnect();"],
        ["an optional call", "await client?.$disconnect();"],
        ["element access", 'await client["$disconnect"]();'],
        ["destructuring", "const { $disconnect } = client;"],
        ["a line that also holds a URL", 'const docs = "http://example.com"; await client.$disconnect();'],
    ])("finds a disconnect written as %s", (_label, code) => {
        expect(mentionsDisconnect(snippet(code))).toBe(true);
    });

    it.each([
        ["no arguments", "new PrismaClient();"],
        ["options", "new PrismaClient({ log: [] });"],
        ["a type argument", "new PrismaClient<Options>();"],
        ["a namespace", "new Prisma.PrismaClient();"],
    ])("finds a client construction with %s", (_label, code) => {
        expect(constructsPrismaClient(snippet(code))).toBe(true);
    });

    it("ignores comments, so src/lib/prisma.ts can document the rule", () => {
        const ast = snippet("/** Never call `$disconnect()` or `new PrismaClient()`. */\n// $disconnect\nexport {};");

        expect(mentionsDisconnect(ast)).toBe(false);
        expect(constructsPrismaClient(ast)).toBe(false);
    });
});

describe("withVerifiedTls", () => {
    it.each([
        ["require, first parameter", "postgresql://u@h/db?sslmode=require", "postgresql://u@h/db?sslmode=verify-full"],
        ["require, later parameter", "postgresql://u@h/db?x=1&sslmode=require", "postgresql://u@h/db?x=1&sslmode=verify-full"],
        ["already verify-full", "postgresql://u@h/db?sslmode=verify-full", "postgresql://u@h/db?sslmode=verify-full"],
        ["no sslmode (local Postgres)", "postgresql://postgres@127.0.0.1:55432/test", "postgresql://postgres@127.0.0.1:55432/test"],
        ["disable", "postgresql://u@h/db?sslmode=disable", "postgresql://u@h/db?sslmode=disable"],
    ])("handles %s", async (_label, url, expected) => {
        const { withVerifiedTls } = await import("./prisma");
        expect(withVerifiedTls(url)).toBe(expected);
    });

    it("leaves an unset URL unset", async () => {
        const { withVerifiedTls } = await import("./prisma");
        expect(withVerifiedTls(undefined)).toBeUndefined();
    });
});
