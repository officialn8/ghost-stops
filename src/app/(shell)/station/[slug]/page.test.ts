import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StationDetailResult } from "@/lib/stations/detail";
import type { StationDetailResponse } from "@/types/station";

const getStationDetail = vi.fn<(slug: string) => Promise<StationDetailResult>>();
vi.mock("./data", () => ({ getStationDetail }));

/** Next's notFound and permanentRedirect throw to stop rendering; the mocks do too, tagged so a test can tell them apart. */
class NavigationThrow extends Error {}
const permanentRedirect = vi.fn((url: string) => {
    throw new NavigationThrow(`redirect ${url}`);
});
const notFound = vi.fn(() => {
    throw new NavigationThrow("not found");
});
vi.mock("next/navigation", () => ({ notFound, permanentRedirect }));

// The page only hands the dossier its props; rendering it is the dossier's own tests' job.
vi.mock("@/components/dossier/StationDossier", () => ({ StationDossier: () => null }));

const { default: StationPage, generateMetadata } = await import("./page");
const { StationDossier } = await import("@/components/dossier/StationDossier");

const params = (slug: string) => Promise.resolve({ slug });

function detail(): StationDetailResponse {
    return {
        dataThrough: "2026-07-31",
        lastSuccessfulFetch: "2026-08-01T11:00:00.000Z",
        station: {
            id: "0b7a6f3e-5d0c-4c43-9a55-1f3d2a9c8e01",
            name: "Halsted (Green)",
            displayName: "Halsted",
            slug: "halsted-green",
            lines: ["Green"],
            latitude: 41.78,
            longitude: -87.64,
            rolling30dAvg: 240,
            status: "ACTIVE",
            closedAt: null,
            openedAt: null,
            dataStatus: "available",
        },
        series: null,
        metrics: {
            ranked: true,
            tier: "ghost",
            rank: 1,
            rankedCount: 140,
            avg12m: 247.6,
            avg30d: 240,
            dataThrough: "2026-07-31",
            scoreVersion: 2,
        },
        comparisons: {
            systemMedian: 1500,
            primaryLine: "Green",
            lineMedian: 1200,
            neighbors: { prev: null, next: null, neighborAvg: 0 },
            lineNeighbors: { prev: null, next: null },
            vsSystemMedian: -84,
            vsLineMedian: -80,
            vsNeighbors: 0,
        },
        whyCard: null,
        facts: null,
        narrative: null,
        sources: null,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("StationPage", () => {
    it("redirects a retired slug permanently to the station's current address", async () => {
        getStationDetail.mockResolvedValue({ kind: "redirect", slug: "halsted-green" });

        await expect(StationPage({ params: params("old-slug") })).rejects.toThrow(NavigationThrow);

        expect(getStationDetail).toHaveBeenCalledWith("old-slug");
        expect(permanentRedirect).toHaveBeenCalledWith("/station/halsted-green");
        expect(notFound).not.toHaveBeenCalled();
    });

    it("answers not found for an address that names no station", async () => {
        getStationDetail.mockResolvedValue({ kind: "not-found" });

        await expect(StationPage({ params: params("nowhere") })).rejects.toThrow(NavigationThrow);

        expect(notFound).toHaveBeenCalledOnce();
        expect(permanentRedirect).not.toHaveBeenCalled();
    });

    it("renders the dossier keyed by the slug", async () => {
        const found = detail();
        getStationDetail.mockResolvedValue({ kind: "found", detail: found });

        const element = await StationPage({ params: params("halsted-green") });

        expect(isValidElement(element)).toBe(true);
        const dossier = element as ReactElement<{ detail: StationDetailResponse }>;
        expect(dossier.type).toBe(StationDossier);
        // The key remounts the dossier when the drawer moves to another station.
        expect(dossier.key).toBe("halsted-green");
        expect(dossier.props.detail).toBe(found);
        expect(permanentRedirect).not.toHaveBeenCalled();
        expect(notFound).not.toHaveBeenCalled();
    });
});

describe("generateMetadata", () => {
    it("adds nothing when no station is found, leaving the not-found page's title", async () => {
        getStationDetail.mockResolvedValue({ kind: "not-found" });

        expect(await generateMetadata({ params: params("nowhere") })).toEqual({});
    });

    it("titles the page with the station, its line, and its riders, and points the canonical at its slug", async () => {
        getStationDetail.mockResolvedValue({ kind: "found", detail: detail() });

        const metadata = await generateMetadata({ params: params("halsted-green") });

        expect(metadata.title).toBe("Halsted (Green) · 248 riders/day");
        expect(metadata.alternates?.canonical).toBe("/station/halsted-green");
        expect(metadata.openGraph?.title).toBe("Halsted (Green) · 248 riders/day · Ghost Stops");
        expect(metadata.description).toEqual(expect.any(String));
        expect(metadata.openGraph?.description).toBe(metadata.description);
    });

    it("uses the station's stored slug as the canonical when the page was reached another way", async () => {
        getStationDetail.mockResolvedValue({ kind: "found", detail: detail() });

        const metadata = await generateMetadata({ params: params("0b7a6f3e-5d0c-4c43-9a55-1f3d2a9c8e01") });

        expect(metadata.alternates?.canonical).toBe("/station/halsted-green");
    });
});
