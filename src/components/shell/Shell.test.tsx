import { act, render, screen, waitFor, within, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StationListItem, StationListResponse } from "@/types/station";

// The route the shell reads its selection from, and the router it navigates with.
const navigation = vi.hoisted(() => ({
  params: {} as { slug?: string },
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));

// Mapbox cannot run in jsdom; the shell's map region is exercised on a preview deployment.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const { Shell } = await import("./Shell");
const { useShell } = await import("./ShellContext");
const { DossierError } = await import("@/components/dossier/DossierError");
const { StationNotFound } = await import("@/components/dossier/StationNotFound");
const { BackToMap, CloseDrawer } = await import("@/components/dossier/CloseControls");
const { ThemeProvider } = await import("@/components/theme");
const { PHONE_QUERY } = await import("@/hooks/useMediaQuery");

/** The shell under the root layout's provider; `rerender` keeps the wrapper. */
function renderShell(ui: React.ReactElement, options: RenderOptions = {}) {
  return render(ui, { wrapper: ThemeProvider, ...options });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function station(
  slug: string,
  displayName: string,
  rank: number | null,
  overrides: Partial<StationListItem> = {},
): StationListItem {
  return {
    id: `${slug}-id`,
    slug,
    displayName,
    name: displayName,
    lines: ["Green"],
    status: rank === null ? "CLOSED" : "ACTIVE",
    closedAt: null,
    latitude: 41.8,
    longitude: -87.6,
    tier: rank === null ? null : "ghost",
    rank,
    rankedCount: 140,
    avg12m: 248,
    avg30d: 240,
    dataStatus: "available",
    sparkline: null,
    badge: null,
    ...overrides,
  };
}

const STATIONS = [station("halsted-green", "Halsted", 1), station("king-drive", "King Drive", 2), station("state-lake", "State/Lake", null)];

function listPayload(lastSuccessfulFetch: string | null = new Date().toISOString()): StationListResponse {
  return { dataThrough: "2026-07-31", lastSuccessfulFetch, stations: STATIONS };
}

function answerList(payload: StationListResponse) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
}

/**
 * The phone layout: only the shell's phone query matches. dom-setup's default stub matches
 * nothing; `vi.unstubAllGlobals()` in afterEach puts it back.
 */
function asPhone() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === PHONE_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/** Renders what the shell knows about the selection, for assertions. */
function SelectionProbe() {
  const { selectedSlug, selected } = useShell();
  return <output data-testid="selection">{`${selectedSlug ?? "none"}|${selected?.displayName ?? "none"}`}</output>;
}

/** A stand-in for the station page's dossier, with the real close controls. */
function FakeDossier({ name }: { name: string }) {
  return (
    <article data-testid="dossier">
      <BackToMap />
      <CloseDrawer />
      <h1>{name}</h1>
    </article>
  );
}

beforeEach(() => {
  navigation.params = {};
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("selection from the route", () => {
  it("marks the station in the URL as selected once the list loads (AE4)", async () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());

    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );

    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("halsted-green|Halsted"));
    const ledger = screen.getByRole("complementary", { name: "Stations" });
    expect(within(ledger).getByRole("button", { name: /Halsted/ })).toHaveAttribute("aria-current", "true");
  });

  it("keeps an unknown slug selected, so the drawer shows the not-found page with a search box", async () => {
    navigation.params = { slug: "no-such-station" };
    answerList(listPayload());

    renderShell(
      <Shell>
        <StationNotFound />
      </Shell>,
    );

    const drawer = screen.getByRole("region", { name: "Station" });
    expect(within(drawer).getByRole("heading", { name: "This stop doesn\u2019t exist. Not even as a ghost." })).toBeInTheDocument();
    const search = within(drawer).getByRole("searchbox", { name: "Station name" });

    await waitFor(() => expect(screen.getAllByRole("button", { name: /King Drive/ }).length).toBeGreaterThan(0));
    await userEvent.type(search, "king");
    expect(within(drawer).getByRole("link", { name: /King Drive/ })).toHaveAttribute("href", "/station/king-drive");
  });

  it("opens no drawer on the map", async () => {
    answerList(listPayload());
    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );
    await waitFor(() => expect(screen.getByTestId("selection")).toHaveTextContent("none|none"));
    expect(screen.queryByRole("region", { name: "Station" })).not.toBeInTheDocument();
  });
});

describe("closing", () => {
  it("pushes / from a direct arrival (R22)", async () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Close station" }));
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("pushes / after hopping to a neighbor, never history.back (AE9)", async () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    const { rerender } = renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );

    navigation.params = { slug: "king-drive" };
    rerender(
      <Shell>
        <FakeDossier name="King Drive" />
      </Shell>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Back to map" }));
    expect(navigation.push).toHaveBeenCalledTimes(1);
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("closes on Escape, but lets a non-empty search field clear itself first", async () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );

    const search = screen.getAllByRole("searchbox", { name: "Search stations" })[0];
    await userEvent.type(search, "hal");
    await userEvent.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(navigation.push).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("closes on Escape on a phone, where the bottom sheet stays mounted under the station page", async () => {
    asPhone();
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );

    // The phone layout: no ledger column, and the sheet's ledger mounted (CSS hides it here).
    expect(screen.queryByRole("complementary", { name: "Stations" })).not.toBeInTheDocument();
    const sheet = await screen.findByRole("dialog", { name: "Stations" });
    await waitFor(() => expect(within(sheet).getAllByRole("button", { name: /King Drive/ }).length).toBeGreaterThan(0));

    await userEvent.keyboard("{Escape}");
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("lets a non-empty search field in the phone's sheet clear itself without closing", async () => {
    asPhone();
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );

    const sheet = await screen.findByRole("dialog", { name: "Stations" });
    const search = within(sheet).getByRole("searchbox", { name: "Search stations" });
    // Focused, not clicked: vaul's pointerdown calls setPointerCapture, which jsdom lacks.
    act(() => search.focus());
    await userEvent.keyboard("hal");
    expect(search).toHaveValue("hal");
    await userEvent.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("soft navigation between stations", () => {
  it("leaves exactly one drawer and one dossier mounted", async () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    const { rerender } = renderShell(
      <Shell>
        <FakeDossier key="halsted-green" name="Halsted" />
      </Shell>,
    );

    navigation.params = { slug: "king-drive" };
    rerender(
      <Shell>
        <FakeDossier key="king-drive" name="King Drive" />
      </Shell>,
    );

    await waitFor(() => expect(screen.getAllByTestId("dossier")).toHaveLength(1));
    expect(screen.getAllByRole("region", { name: "Station" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "King Drive" })).toBeInTheDocument();
  });
});

describe("the drawer's motion", () => {
  it("shows the arrival drawer at once, removes it at once on close, and slides in one opened later", () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    const { rerender } = renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );
    // A station link's drawer is in place from the first (server) render, not faded in from 0.
    expect(screen.getByRole("region", { name: "Station" }).style.opacity).not.toBe("0");

    // Closing: the "/" page renders nothing, and no exiting panel lingers to fade.
    navigation.params = {};
    rerender(<Shell>{null}</Shell>);
    expect(screen.queryByRole("region", { name: "Station" })).not.toBeInTheDocument();

    navigation.params = { slug: "king-drive" };
    rerender(
      <Shell>
        <FakeDossier name="King Drive" />
      </Shell>,
    );
    expect(screen.getByRole("region", { name: "Station" }).style.opacity).toBe("0");
  });
});

describe("search, line filter, and sort (the shell's own state)", () => {
  // Distinct riders figures, so a riders sort has one order each way, and one Red station.
  const SORTABLE = [
    station("halsted-green", "Halsted", 1, { avg12m: 248 }),
    station("king-drive", "King Drive", 2, { avg12m: 910 }),
    station("jackson-red", "Jackson", 3, { avg12m: 530, lines: ["Red"] }),
  ];

  function answerSortable() {
    answerList({ ...listPayload(), stations: SORTABLE });
  }

  function ledger(): HTMLElement {
    return screen.getByRole("complementary", { name: "Stations" });
  }

  /** The ranked rows in the ledger column, top to bottom, by slug. */
  function rankedSlugs(): string[] {
    const ranked = within(ledger()).getByRole("list", { name: "Ranked stations" });
    return [...ranked.querySelectorAll<HTMLElement>("[data-station-row]")].map((row) => row.dataset.stationRow ?? "");
  }

  async function listLoaded() {
    await waitFor(() => expect(rankedSlugs()).toHaveLength(3));
  }

  it("sorts by riders ascending, then reverses on a second click", async () => {
    answerSortable();
    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );
    await listLoaded();
    expect(rankedSlugs()).toEqual(["halsted-green", "king-drive", "jackson-red"]);

    await userEvent.click(within(ledger()).getByRole("button", { name: "Sort by riders per day" }));
    const riders = within(ledger()).getByRole("button", { name: /^Sort by riders per day/ });
    expect(riders).toHaveAccessibleName("Sort by riders per day, ascending");
    expect(rankedSlugs()).toEqual(["halsted-green", "jackson-red", "king-drive"]);

    await userEvent.click(riders);
    expect(riders).toHaveAccessibleName(/descending$/);
    expect(rankedSlugs()).toEqual(["king-drive", "jackson-red", "halsted-green"]);
  });

  it("drops a line's stations when it is toggled off, and reads every line off as every line on", async () => {
    answerSortable();
    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );
    await listLoaded();

    const green = within(ledger()).getByRole("button", { name: "Green Line" });
    await userEvent.click(green);
    expect(green).toHaveAttribute("aria-pressed", "false");
    expect(rankedSlugs()).toEqual(["jackson-red"]);

    const others = within(ledger())
      .getAllByRole("button", { name: / Line$/ })
      .filter((toggle) => toggle !== green);
    for (const toggle of others) await userEvent.click(toggle);

    expect(rankedSlugs()).toEqual(["halsted-green", "king-drive", "jackson-red"]);
    for (const toggle of within(ledger()).getAllByRole("button", { name: / Line$/ })) {
      expect(toggle).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("keeps the search query and the sort across a hop to another station", async () => {
    navigation.params = { slug: "halsted-green" };
    answerSortable();
    const { rerender } = renderShell(
      <Shell>
        <FakeDossier name="Halsted" />
      </Shell>,
    );
    await listLoaded();

    const search = within(ledger()).getByRole("searchbox", { name: "Search stations" });
    await userEvent.type(search, "k");
    await userEvent.click(within(ledger()).getByRole("button", { name: "Sort by name" }));
    await userEvent.click(within(ledger()).getByRole("button", { name: "Sort by name, ascending" }));

    navigation.params = { slug: "king-drive" };
    rerender(
      <Shell>
        <FakeDossier name="King Drive" />
      </Shell>,
    );

    expect(screen.getByRole("heading", { name: "King Drive" })).toBeInTheDocument();
    expect(within(ledger()).getByRole("searchbox", { name: "Search stations" })).toHaveValue("k");
    expect(within(ledger()).getByRole("button", { name: /^Sort by name/ })).toHaveAccessibleName(
      "Sort by name, descending",
    );
    // "k" matches King Drive and Jackson; descending by name puts King Drive first.
    expect(rankedSlugs()).toEqual(["king-drive", "jackson-red"]);
  });
});

describe("list loading states", () => {
  it("shows the error row with a retry, not a skeleton, when the list fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );

    const ledger = screen.getByRole("complementary", { name: "Stations" });
    const alert = await within(ledger).findByRole("alert");
    expect(alert).toHaveTextContent("Stations could not be loaded.");
    expect(within(ledger).queryByLabelText("Loading stations")).not.toBeInTheDocument();

    answerList(listPayload());
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await within(ledger).findByRole("button", { name: /King Drive/ })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("turns a slow fetch into the error row, then shows the list if it lands", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: (response: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));

    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );
    const ledger = screen.getByRole("complementary", { name: "Stations" });
    expect(within(ledger).getByLabelText("Loading stations")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(8_000);
    });
    expect(within(ledger).getByRole("alert")).toHaveTextContent("taking longer than usual");

    await act(async () => {
      answer(new Response(JSON.stringify(listPayload()), { status: 200 }));
    });
    expect(await within(ledger).findByRole("button", { name: /Halsted/ })).toBeInTheDocument();
  });
});

describe("health banner", () => {
  it("appears when the last successful refresh is 11 days old (R13)", async () => {
    answerList(listPayload(new Date(Date.now() - 11 * DAY_MS).toISOString()));
    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );
    const banner = await screen.findByText(/Ridership has not refreshed since/);
    expect(banner.closest("[role=status]")).not.toBeNull();
  });

  it("stays away when the last refresh is recent", async () => {
    answerList(listPayload(new Date(Date.now() - 2 * DAY_MS).toISOString()));
    renderShell(
      <Shell>
        <SelectionProbe />
      </Shell>,
    );
    await waitFor(() => expect(screen.getAllByText("2026-07-31").length).toBeGreaterThan(0));
    expect(screen.queryByText(/has not refreshed/)).not.toBeInTheDocument();
  });
});

describe("a station page that fails to load", () => {
  it("shows the inline message and retries by refreshing the route", async () => {
    navigation.params = { slug: "halsted-green" };
    answerList(listPayload());
    const reset = vi.fn();
    renderShell(
      <Shell>
        <DossierError reset={reset} />
      </Shell>,
    );

    const drawer = screen.getByRole("region", { name: "Station" });
    expect(within(drawer).getByRole("alert")).toHaveTextContent("This station could not be loaded.");
    await userEvent.click(within(drawer).getByRole("button", { name: "Try again" }));
    expect(navigation.refresh).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });
});
