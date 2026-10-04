import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ALL_LINES_ON } from "@/components/shell/model";
import { ShellContext, type ListState, type ShellModel } from "@/components/shell/ShellContext";
import { dossierFixture, noDataDossier, noNarrativeDossier, type FixtureStationName } from "@/test/fixtures/dossier";
import type { StationDetailResponse } from "@/types/station";
import { StationDossier } from "./StationDossier";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({}),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function shellModel(list: ListState): ShellModel {
  return {
    list,
    retryList: vi.fn(),
    stations: [],
    stationBySlug: new Map(),
    selectedSlug: null,
    selected: null,
    openStation: vi.fn(),
    closeStation: vi.fn(),
    query: "",
    setQuery: vi.fn(),
    activeLines: ALL_LINES_ON,
    toggleLine: vi.fn(),
    sort: { key: "rank", direction: "asc" },
    sortBy: vi.fn(),
  };
}

/** The shell's list as loaded, stale when its last successful refresh is over ten days old. */
function readyList(detail: StationDetailResponse, stale = false): ListState {
  return {
    status: "ready",
    stale,
    data: { dataThrough: detail.dataThrough, lastSuccessfulFetch: detail.lastSuccessfulFetch, stations: [] },
  };
}

function renderDossier(detail: StationDetailResponse, list: ListState = readyList(detail)) {
  return render(
    <ShellContext.Provider value={shellModel(list)}>
      <StationDossier detail={detail} />
    </ShellContext.Provider>,
  );
}

const header = () => screen.getByRole("heading", { level: 1 }).closest("header")!;
const section = (name: string | RegExp) => screen.getByRole("region", { name });
const scoreParts = () => within(screen.getByRole("list", { name: "Score parts" })).getAllByRole("listitem");
const part = (key: string) => scoreParts().find((row) => row.dataset.component === key)!;

describe("the sign header", () => {
  it("names the station, gives its tier word and rank beside the number, and takes focus", () => {
    renderDossier(dossierFixture("Halsted (Green)"));

    const name = screen.getByRole("heading", { level: 1, name: "Halsted" });
    expect(name).toHaveFocus();
    expect(within(header()).getByText("Green Line")).toBeInTheDocument();
    expect(within(header()).getByText("Ghost")).toBeInTheDocument();
    expect(within(header()).getByText("1st").closest("p")).toHaveTextContent("1st of 25 ranked");
    // The 12-month average, the ledger's number (R25), stated once for screen readers.
    expect(within(header()).getByText("263", { selector: ".sr-only" })).toBeInTheDocument();
    expect(within(header()).getByText("Riders per day over the last 12 months.")).toBeInTheDocument();
    expect(within(header()).getByText("Tiers compare each station with the other ranked stations.")).toBeInTheDocument();
    // The 0 to 100 value appears only inside the card (R26).
    expect(within(header()).queryByText("100")).not.toBeInTheDocument();
  });

  it.each<[FixtureStationName, string[]]>([
    ["Halsted (Green)", []],
    ["Wilson", ["Transfer"]],
    ["O'Hare", ["Terminal"]],
    ["State/Lake", ["Transfer"]],
  ])("tags %s with %j", (station, tags) => {
    renderDossier(dossierFixture(station));
    for (const tag of ["Transfer", "Terminal"]) {
      if (tags.includes(tag)) expect(within(header()).getByText(tag)).toBeInTheDocument();
      else expect(within(header()).queryByText(tag)).not.toBeInTheDocument();
    }
  });

  it("shows a closed station's status and closure month in place of tier and rank (AE2)", () => {
    renderDossier(dossierFixture("State/Lake"));
    expect(within(header()).getByText("Closed since Jan 2026")).toBeInTheDocument();
    expect(within(header()).queryByText(/ranked$/)).not.toBeInTheDocument();
    expect(within(header()).queryByText(/riders per day/i)).not.toBeInTheDocument();
  });

  it('shows "No recent data" in place of tier and rank for a station with no recent riders', () => {
    renderDossier(noDataDossier());
    expect(within(header()).getByText("No recent data")).toBeInTheDocument();
    expect(within(header()).getByText("2026-05-20")).toBeInTheDocument();
    expect(within(header()).queryByText(/ranked$/)).not.toBeInTheDocument();
    for (const tier of ["Ghost", "Fading", "Quiet", "Healthy"]) {
      expect(within(header()).queryByText(tier)).not.toBeInTheDocument();
    }
  });
});

describe("against baselines", () => {
  it("compares the 30-day average with the system, line, and neighbors as numbers and words, not tracks", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const baselines = section("Against baselines");
    expect(baselines).toHaveTextContent("Riders per day over the last 30 days. This station: 290.");
    const system = within(baselines).getByText("System median").closest("div")!;
    expect(system).toHaveTextContent("System median 3,229 This station is 91% below");
    expect(within(baselines).getByText("Green Line median")).toBeInTheDocument();
    expect(within(baselines).getByText("Garfield and Ashland/63rd")).toBeInTheDocument();
  });

  it("is left out for a closed station", () => {
    renderDossier(dossierFixture("State/Lake"));
    expect(screen.queryByRole("region", { name: "Against baselines" })).not.toBeInTheDocument();
  });
});

describe("the why card", () => {
  it("AE1: Lawrence's year-over-year row carries the reopened chip, the other rows their values, and no badge", () => {
    renderDossier(dossierFixture("Lawrence"));

    expect(scoreParts().map((row) => row.dataset.component)).toEqual(["residual", "yoy", "longRun", "erratic"]);
    const yoy = part("yoy");
    expect(within(yoy).getByText("Change from last year")).toBeInTheDocument();
    expect(within(yoy).getByText("reopened Jul 2025, year-over-year available from Oct 2026")).toBeInTheDocument();
    expect(within(yoy).getByText("n/a")).toBeInTheDocument();

    expect(part("residual")).toHaveTextContent("Gets 53% of the riders its neighbors Argyle and Wilson get.");
    expect(part("longRun")).toHaveTextContent("Carries 33% fewer riders than in 2019.");
    expect(part("erratic")).toHaveTextContent("Ridership swings about 12% day to day.");
    for (const key of ["residual", "longRun", "erratic"]) {
      expect(within(part(key)).queryByText("n/a")).not.toBeInTheDocument();
    }

    const why = section("Why it ranks here");
    expect(within(why).getByRole("list", { name: "Data notes" })).toHaveTextContent("reopened Jul 2025");
    expect(within(why).queryByText(/small but/i)).not.toBeInTheDocument();
  });

  it("AE2: State/Lake states its closure and has no component rows", () => {
    renderDossier(dossierFixture("State/Lake"));
    const why = section("Why it is not ranked");
    expect(within(why).getByText(/^State\/Lake has been closed since Jan 2026\./)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Score parts" })).not.toBeInTheDocument();
    expect(within(why).queryByText("Score")).not.toBeInTheDocument();
  });

  it("shows the 0 to 100 score once, with its tier, the 30-day average, and the weights", () => {
    renderDossier(dossierFixture("Damen (Green)"));
    const why = section("Why it ranks here");
    expect(screen.getAllByText("58")).toHaveLength(1);
    expect(within(why).getByText("58")).toBeInTheDocument();
    expect(within(why).getByText(/Quiet tier, scores 50 to 74\./)).toBeInTheDocument();
    expect(within(why).getByText("30-day average")).toBeInTheDocument();
    expect(scoreParts().map((row) => within(row).getByText(/^\d+%$/).textContent)).toEqual([
      "weight 45%",
      "weight 25%",
      "weight 20%",
      "weight 10%",
    ]);
  });

  it("marks a new station with its chip and explains its missing 2019 comparison", () => {
    renderDossier(dossierFixture("Damen (Green)"));
    expect(screen.getByRole("list", { name: "Data notes" })).toHaveTextContent("opened Aug 2024");
    expect(within(part("longRun")).getByText("opened Aug 2024, no 2019 comparison")).toBeInTheDocument();
  });

  it("explains a station whose year-over-year a closure next door set aside", () => {
    renderDossier(dossierFixture("Wilson"));
    expect(within(part("yoy")).getByText(/^Lawrence reopened next door in Jul 2025; year-over-year comparable again/)).toBeInTheDocument();
  });

  it("names the small-station badge in words", () => {
    const detail = dossierFixture("LaSalle/Van Buren");
    renderDossier({ ...detail, whyCard: { ...detail.whyCard!, badge: "small-but-growing" } });
    expect(within(screen.getByRole("list", { name: "Data notes" })).getByText("Small but growing")).toBeInTheDocument();
  });

  it("links the peers the residual used and states their median", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const why = section("Why it ranks here");
    const peers = within(why).getByText(/^Peers:/);
    expect(within(peers).getByRole("link", { name: "Garfield" })).toHaveAttribute("href", "/station/garfield-green");
    expect(peers).toHaveTextContent("its nearest neighbors on the Green Line. Their median is 547 riders a day over the last 12 months.");
  });

  it("states that a station with no recent riders is not ranked, with its stale chip", () => {
    renderDossier(noDataDossier());
    const why = section("Why it is not ranked");
    expect(within(why).getByText(/has no riders in recent data/)).toBeInTheDocument();
    expect(within(why).getByRole("list", { name: "Data notes" })).toHaveTextContent("no ridership data in the last 60 days");
  });

  it("says so when the station has no score v2 metrics yet", () => {
    renderDossier({ ...dossierFixture("Halsted (Green)"), whyCard: null });
    expect(screen.getByText("Score details are not available yet.")).toBeInTheDocument();
  });
});

describe("the story", () => {
  it.each<FixtureStationName>(["Logan Square", "Wilson", "O'Hare", "Western (O'Hare)"])(
    "gives healthy %s a growth or stable story and no ghost wording",
    (station) => {
      const { container } = renderDossier(dossierFixture(station));
      const title = screen.getByRole("heading", { level: 3 });
      expect(["Gaining Riders.", "Holding Its Own."]).toContain(title.textContent);
      expect(screen.getByRole("heading", { level: 2, name: "Why it ranks here" })).toBeInTheDocument();
      for (const heading of screen.getAllByRole("heading")) expect(heading.textContent).not.toMatch(/ghost/i);
      expect(container.textContent).not.toMatch(/ghost/i);
    },
  );

  it("renders the story's figures as text, with no markup characters, and its evidence as a definition list", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const why = section("Why it ranks here");
    expect(within(why).getByRole("heading", { level: 3, name: "The Suburban Shift." })).toBeInTheDocument();
    expect(why.textContent).not.toContain("*");
    expect(within(why).getByText("523", { selector: "strong" })).toHaveClass("font-mono");

    const evidence = within(why).getByText("2001 Ridership").closest("div")!;
    expect(evidence).toHaveTextContent("2001, at the station");
    expect(within(evidence).getByText("Method and source").closest("summary")).toBeInTheDocument();
    expect(within(evidence).getByText("Daily average for calendar year 2001")).toBeInTheDocument();
    expect(within(why).getByText("Population Change").closest("div")).toHaveTextContent("2010 to 2024, within half a mile");
  });

  it("leaves the story out entirely when the response has none", () => {
    renderDossier(noNarrativeDossier());
    const why = section("Why it ranks here");
    expect(screen.getByRole("list", { name: "Score parts" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(within(why).queryByText("Evidence")).not.toBeInTheDocument();
    for (const region of screen.getAllByRole("region")) {
      expect(region.textContent?.trim()).not.toBe(within(region).getByRole("heading", { level: 2 }).textContent);
    }
  });
});

describe("along the line", () => {
  it("links the stations either side by slug, with their standing", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const line = section("Along the Green Line");
    const [prev, next] = within(line).getAllByRole("link");
    expect(prev).toHaveAttribute("href", "/station/garfield-green");
    expect(prev).toHaveTextContent("Previous stopGarfieldHealthy");
    expect(next).toHaveAttribute("href", "/station/ashland-63rd");
    expect(next).toHaveTextContent("Next stopAshland/63rdQuiet");
  });

  it("shows a closed neighbor's status and opens its closure dossier (AE2)", () => {
    renderDossier(dossierFixture("Washington/Wabash"));
    const line = section("Along the Brown Line");
    const stateLake = within(line).getByRole("link", { name: /State\/Lake/ });
    expect(stateLake).toHaveAttribute("href", "/station/state-lake");
    expect(stateLake).toHaveTextContent("Closed");
  });

  it("has one row at a terminal", () => {
    renderDossier(dossierFixture("O'Hare"));
    const links = within(section("Along the Blue Line")).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Next stopRosemont");
  });
});

describe("the chart", () => {
  it("states its date range under the chart", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const chart = section("Last 90 days");
    expect(within(chart).getByText("Daily riders, May 2 to Jul 31, 2026.")).toBeInTheDocument();
    expect(within(chart).getByRole("img", { name: /^Daily riders, May 2 to Jul 31, 2026\. Average/ })).toBeInTheDocument();
  });
});

describe("sources", () => {
  it("AE6: states the data-through date as the calendar string and CTA's publishing lag", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const sources = section("Sources");
    expect(within(sources).getByText("2026-07-31")).toHaveAttribute("dateTime", "2026-07-31");
    expect(sources).toHaveTextContent(
      "Ridership from the CTA's daily station entries, published about two months after the fact (data through 2026-07-31).",
    );
    expect(sources).not.toHaveTextContent("last successful refresh");
  });

  it("adds the last-refresh sentence when the last successful refresh is 11 days old (AE6, R13)", () => {
    const lastSuccessfulFetch = new Date(Date.now() - 11 * DAY_MS).toISOString();
    const detail = { ...dossierFixture("Halsted (Green)"), lastSuccessfulFetch };
    renderDossier(detail, readyList(detail, true));
    const expected = new Date(lastSuccessfulFetch).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Chicago",
    });
    expect(section("Sources")).toHaveTextContent(`The last successful refresh was on ${expected}.`);
  });

  it("lists the facts' sources in a disclosure", () => {
    renderDossier(dossierFixture("Halsted (Green)"));
    const sources = section("Sources");
    expect(within(sources).getByText("Sources for the station facts (2)").closest("summary")).toBeInTheDocument();
    expect(within(sources).getByRole("link", { name: /American Community Survey/ })).toHaveAttribute("href", "https://data.census.gov/");
  });
});

describe("rendered text", () => {
  it.each<FixtureStationName>([
    "Halsted (Green)",
    "Logan Square",
    "State/Lake",
    "Damen (Green)",
    "Lawrence",
    "LaSalle/Van Buren",
    "Wilson",
    "O'Hare",
    "Western (O'Hare)",
  ])("has no em or en dashes for %s", (station) => {
    const { container } = renderDossier(dossierFixture(station));
    expect(container.textContent).not.toMatch(/[–—]/);
    for (const el of container.querySelectorAll("[aria-label],[title]")) {
      expect(`${el.getAttribute("aria-label") ?? ""}${el.getAttribute("title") ?? ""}`).not.toMatch(/[–—]/);
    }
  });
});
