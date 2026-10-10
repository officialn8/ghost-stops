import { describe, expect, it } from "vitest";
import { bearerMatches } from "./bearerAuth";

describe("bearerMatches", () => {
    it("accepts exactly Bearer followed by the secret", () => {
        expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
    });

    it("rejects a missing header, a bare secret, another secret, a prefix, and a case change", () => {
        expect(bearerMatches(null, "s3cret")).toBe(false);
        expect(bearerMatches(undefined, "s3cret")).toBe(false);
        expect(bearerMatches("s3cret", "s3cret")).toBe(false);
        expect(bearerMatches("Bearer other", "s3cret")).toBe(false);
        expect(bearerMatches("Bearer s3cret2", "s3cret")).toBe(false);
        expect(bearerMatches("bearer s3cret", "s3cret")).toBe(false);
    });

    it("matches nothing when the secret is unset or empty", () => {
        expect(bearerMatches("Bearer ", "")).toBe(false);
        expect(bearerMatches("Bearer ", undefined)).toBe(false);
        expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    });
});
