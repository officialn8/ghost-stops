import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dossierFixture } from "@/test/fixtures/dossier";
import type { StationListItem, StationListResponse } from "@/types/station";

/**
 * Focus across the dossier's life in the real shell (R28): the station name takes it on open, and
 * on close the shell hands it back to the ledger row the dossier was opened from when that row is
 * on screen, else to the ledger's search field.
 */
const navigation = vi.hoisted(() => ({
  params: {} as { slug?: string },
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));

// Mapbox cannot run in jsdom.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const { Shell } = await import("@/components/shell/Shell");
const { ThemeProvider } = await import("@/components/theme");
const { StationDossier } = await import("./StationDossier");

const halsted = dossierFixture("Halsted (Green)");

const listItem: StationListItem = {
  id: halsted.station.id,
  slug: "halsted-green",
  displayName: "Halsted",
  name: "Halsted (Green)",
  lines: ["Green"],
  status: "ACTIVE",
  closedAt: null,
  latitude: 41.78,
  longitude: -87.64,
  tier: "ghost",
  rank: 1,
  rankedCount: 25,
  avg12m: 263,
  avg30d: 290,
  dataStatus: "available",
  sparkline: null,
  badge: null,
};

const list: StationListResponse = { dataThrough: "2026-07-31", lastSuccessfulFetch: new Date().toISOString(), stations: [listItem] };

/** jsdom lays nothing out; report every element as on screen except those `hidden` matches. */
function layout(hidden: (element: HTMLElement) => boolean) {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (hidden(this) ? [] : [new DOMRect(0, 0, 10, 10)]) as unknown as DOMRectList;
  });
}

function openThenClose() {
  navigation.params = { slug: "halsted-green" };
  const { rerender } = render(
    <Shell>
      <StationDossier key="halsted-green" detail={halsted} />
    </Shell>,
    { wrapper: ThemeProvider },
  );
  return () => {
    navigation.params = {};
    rerender(<Shell>{null}</Shell>);
  };
}

beforeEach(() => {
  navigation.params = {};
  navigation.push.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(list), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dossier focus", () => {
  it("moves focus to the station name when the dossier opens", async () => {
    layout(() => false);
    openThenClose();
    expect(screen.getByRole("heading", { level: 1, name: "Halsted" })).toHaveFocus();
    await waitFor(() => expect(document.querySelector('[data-station-row="halsted-green"]')).not.toBeNull());
  });

  it("closes from the drawer's close button by pushing the map", async () => {
    layout(() => false);
    openThenClose();
    const drawer = screen.getByRole("region", { name: "Station" });
    await userEvent.click(within(drawer).getByRole("button", { name: "Close station" }));
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("returns focus to the originating ledger row when it is on screen", async () => {
    layout(() => false);
    const close = openThenClose();
    await waitFor(() => expect(document.querySelector('[data-station-row="halsted-green"]')).not.toBeNull());

    close();
    expect(document.querySelector('[data-station-row="halsted-green"]')).toHaveFocus();
  });

  it("moves focus to the search field when the originating row is hidden", async () => {
    layout((element) => element.hasAttribute("data-station-row"));
    const close = openThenClose();
    await waitFor(() => expect(document.querySelector('[data-station-row="halsted-green"]')).not.toBeNull());

    close();
    expect(document.querySelector("[data-ledger-search]")).toHaveFocus();
  });
});
