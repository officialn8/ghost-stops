import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { CTA_ROSTER } from "@/lib/cta/roster";

describe("sitemap", () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);

    it("lists the map, the method page, and one page per station, open and closed", () => {
        expect(urls[0]).toBe("/");
        expect(urls[1]).toBe("/method");
        expect(urls).toHaveLength(CTA_ROSTER.length + 2);
        expect(new Set(urls).size).toBe(urls.length);
    });

    it.each(["/station/halsted-green", "/station/state-lake", "/station/western-blue-ohare", "/station/95th-dan-ryan", "/station/ohare"])(
        "includes %s",
        (path) => {
            expect(urls).toContain(path);
        },
    );
});
