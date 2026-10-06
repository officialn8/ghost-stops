import { useCallback, useMemo, useState } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_LINES_ON } from "@/components/shell/model";
import {
  ShellContext,
  type ActiveLines,
  type ListState,
  type ShellModel,
  type SortKey,
  type SortState,
} from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER, type CTALine } from "@/lib/utils";
import type { StationListItem } from "@/types/station";
import { LEDGER_STATIONS } from "./__fixtures__/stations";
import { LEDGER_LIST_ID, Ledger } from "./Ledger";

const NO_STATIONS: readonly StationListItem[] = [];

function ready(stations: readonly StationListItem[] = LEDGER_STATIONS): ListState {
  return {
    status: "ready",
    stale: false,
    data: { dataThrough: "2026-07-31", lastSuccessfulFetch: "2026-10-03T00:00:00.000Z", stations: [...stations] },
  };
}

/**
 * The ledger under a shell model with real search, filter, and sort state, wired like the shell's:
 * repeat sorts reverse, and toggles flip one line. The selection comes from props, as the URL
 * drives it in the app.
 */
function Harness({
  list,
  selectedSlug = null,
  openStation,
  retryList = () => {},
  variant = "column",
}: {
  list: ListState;
  selectedSlug?: string | null;
  openStation: (slug: string) => void;
  retryList?: () => void;
  variant?: "column" | "sheet";
}) {
  const [query, setQuery] = useState("");
  const [activeLines, setActiveLines] = useState<ActiveLines>(ALL_LINES_ON);
  const [sort, setSort] = useState<SortState>({ key: "rank", direction: "asc" });
  const stations = list.status === "ready" ? list.data.stations : NO_STATIONS;

  const toggleLine = useCallback(
    (line: CTALine) => setActiveLines((current) => ({ ...current, [line]: !current[line] })),
    [],
  );
  const sortBy = useCallback(
    (key: SortKey) =>
      setSort((current) =>
        current.key === key
          ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
          : { key, direction: "asc" },
      ),
    [],
  );

  const model = useMemo<ShellModel>(() => {
    const stationBySlug = new Map(stations.flatMap((s) => (s.slug ? [[s.slug, s] as const] : [])));
    return {
      list,
      retryList,
      stations,
      stationBySlug,
      selectedSlug,
      selected: selectedSlug ? (stationBySlug.get(selectedSlug) ?? null) : null,
      openStation,
      closeStation: () => {},
      query,
      setQuery,
      activeLines,
      toggleLine,
      sort,
      sortBy,
    };
  }, [list, retryList, stations, selectedSlug, openStation, query, activeLines, toggleLine, sort, sortBy]);

  return (
    <ShellContext.Provider value={model}>
      <Ledger variant={variant} />
    </ShellContext.Provider>
  );
}

const openStation = vi.fn();

beforeEach(() => {
  openStation.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Station rows in document order, by slug. */
function rowSlugs(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-station-row]")].map((row) => row.dataset.stationRow ?? "");
}

function row(slug: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-station-row="${slug}"]`);
  if (!element) throw new Error(`no row for ${slug}`);
  return element;
}

function lineToggle(line: CTALine): HTMLElement {
  return screen.getByRole("button", { name: `${line} Line` });
}

describe("rows", () => {
  it("names each row by station first, with its lines, rank, tier, and 12-month riders per day", () => {
    render(<Harness list={ready()} openStation={openStation} />);

    expect(row("halsted-green")).toHaveAccessibleName("Halsted, Green Line, rank 2 of 6, ghost, 248 riders per day");
    expect(row("clark-lake")).toHaveAccessibleName(
      "Clark/Lake, Blue, Brown, Green, Orange, Purple, Pink Lines, rank 6 of 6, healthy, 12,035 riders per day",
    );
    expect(within(row("clark-lake")).getByText("12,035")).toBeInTheDocument();
  });

  it("shows a closed station's closure month and a no-data station's status in place of riders", () => {
    render(<Harness list={ready()} openStation={openStation} />);

    expect(row("state-lake")).toHaveAccessibleName("State/Lake, Brown, Green, Orange, Purple, Pink Lines, closed Jan 2026");
    expect(within(row("state-lake")).getByText("closed Jan 2026")).toBeInTheDocument();
    expect(row("cicero-pink")).toHaveAccessibleName("Cicero, Pink Line, no recent data");
    expect(within(row("cicero-pink")).getByText("no recent data")).toBeInTheDocument();
  });

  it("are buttons that Tab reaches after the header controls, and Enter opens one", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    // Search, the line filter (one stop), three sort heads, then the first row (R28).
    await user.tab();
    expect(screen.getByRole("searchbox", { name: "Search stations" })).toHaveFocus();
    for (let i = 0; i < 5; i++) await user.tab();
    expect(row("oak-park-green")).toHaveFocus();

    // The rows share that one stop; the arrow keys move between them.
    await user.keyboard("{ArrowDown}");
    expect(row("halsted-green")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(openStation).toHaveBeenCalledWith("halsted-green");
  });

  it("opens a closed station's dossier from its row", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    await userEvent.click(row("state-lake"));
    expect(openStation).toHaveBeenCalledWith("state-lake");
  });

  it("marks the selected row as current", () => {
    render(<Harness list={ready()} openStation={openStation} selectedSlug="monroe-red" />);
    expect(row("monroe-red")).toHaveAttribute("aria-current", "true");
    expect(row("ohare")).not.toHaveAttribute("aria-current");
  });

  it("labels each sparkline with its date range", () => {
    render(<Harness list={ready()} openStation={openStation} />);
    expect(within(row("oak-park-green")).getByRole("img", { name: "Riders per day, Jul 25 to Jul 31, 2026" })).toBeInTheDocument();
  });
});

describe("trailing sections (AE2)", () => {
  it("keeps State/Lake under Closed, after every ranked row, under every sort key and direction", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    const check = () => {
      const closed = screen.getByRole("list", { name: "Closed, 1 station" });
      expect(within(closed).getByRole("button", { name: /^State\/Lake/ })).toBeInTheDocument();
      const order = rowSlugs();
      expect(order.indexOf("state-lake")).toBeGreaterThan(order.indexOf("clark-lake"));
      expect(order.indexOf("state-lake")).toBeGreaterThan(order.indexOf("oak-park-green"));
      expect(order.slice(-2)).toEqual(["state-lake", "cicero-pink"]);
    };

    check();
    for (const name of [/^Sort by rank/, /^Sort by riders per day/, /^Sort by name/]) {
      await user.click(screen.getByRole("button", { name }));
      check();
      await user.click(screen.getByRole("button", { name }));
      check();
    }
    expect(screen.getByRole("heading", { name: "Closed, 1 station" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No recent data, 1 station" })).toBeInTheDocument();
  });
});

describe("sort", () => {
  it("toggles direction when the active key is chosen again", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    expect(screen.getByRole("button", { name: "Sort by rank, 1 first" })).toHaveAttribute("aria-pressed", "true");
    const riders = screen.getByRole("button", { name: "Sort by riders per day" });
    expect(riders).toHaveAttribute("aria-pressed", "false");

    await user.click(riders);
    expect(riders).toHaveAccessibleName("Sort by riders per day, fewest first");
    expect(riders).toHaveAttribute("aria-pressed", "true");
    expect(rowSlugs()[0]).toBe("halsted-green");

    await user.click(riders);
    expect(riders).toHaveAccessibleName("Sort by riders per day, most first");
    expect(rowSlugs()[0]).toBe("clark-lake");
    expect(screen.getByRole("button", { name: "Sort by rank" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("line filter", () => {
  it("hides stations on a line that is turned off, and says so without color", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const red = lineToggle("Red");
    expect(red).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(red);
    expect(red).toHaveAttribute("aria-pressed", "false");
    expect(red).toHaveClass("line-through");
    expect(rowSlugs()).not.toContain("monroe-red");
    expect(screen.getByRole("status")).toHaveTextContent("7 stations match");
  });

  it("treats every line off as every line on", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    for (const line of CTA_LINE_ORDER) await user.click(lineToggle(line));

    expect(rowSlugs()).toHaveLength(8);
    for (const line of CTA_LINE_ORDER) expect(lineToggle(line)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("8 stations");
  });
});

describe("search", () => {
  it("shows a no-match row with a clear action", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", { name: "Search stations" });

    await user.type(search, "xyz");
    expect(screen.getByText(/No stations match “xyz”/)).toBeInTheDocument();
    expect(rowSlugs()).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("No stations match");

    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(rowSlugs()).toHaveLength(8);
  });

  it("opens the first match on Enter", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    await user.type(screen.getByRole("searchbox", { name: "Search stations" }), "Halsted{Enter}");
    expect(openStation).toHaveBeenCalledTimes(1);
    expect(openStation).toHaveBeenCalledWith("halsted-green");
    expect(screen.getByRole("status")).toHaveTextContent("2 stations match");
  });

  it("opens nothing on Enter when nothing matches", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search stations" }), "xyz{Enter}");
    expect(openStation).not.toHaveBeenCalled();
  });

  it("clears a query on the first Escape and stops the key, then lets the next Escape through", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();
    // What the drawer's window listener would see.
    let reachedWindow = 0;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") reachedWindow += 1;
    };
    window.addEventListener("keydown", listener);

    const search = screen.getByRole("searchbox", { name: "Search stations" });
    await user.type(search, "hal");
    await user.keyboard("{Escape}");
    expect(search).toHaveValue("");
    expect(reachedWindow).toBe(0);
    await user.keyboard("{Escape}");
    window.removeEventListener("keydown", listener);

    expect(reachedWindow).toBe(1);
  });
});

describe("selection visibility", () => {
  it("shows and scrolls to a selected station that the Red-only filter hides", async () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { rerender } = render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    for (const line of CTA_LINE_ORDER) if (line !== "Red") await user.click(lineToggle(line));
    expect(rowSlugs()).toEqual(["monroe-red"]);
    scrolled.mockClear();

    rerender(<Harness list={ready()} openStation={openStation} selectedSlug="halsted-green" />);

    const selected = row("halsted-green");
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(within(selected).getByText("outside filter")).toBeInTheDocument();
    expect(selected).toHaveAccessibleName(/^Halsted, Green Line, .*outside filter$/);
    expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
    expect(scrolled.mock.contexts).toContain(selected);
    // The announced count is still the filter's.
    expect(screen.getByRole("status")).toHaveTextContent("1 station matches");
  });

  it("scrolls to a deep-linked station once the list loads", () => {
    const scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
    const { rerender } = render(<Harness list={{ status: "loading" }} openStation={openStation} selectedSlug="clark-lake" />);
    expect(scrolled).not.toHaveBeenCalled();

    rerender(<Harness list={ready()} openStation={openStation} selectedSlug="clark-lake" />);
    expect(scrolled.mock.contexts).toContain(row("clark-lake"));
  });
});

describe("list states", () => {
  it("shows the shell's loading rows while the list loads", () => {
    render(<Harness list={{ status: "loading" }} openStation={openStation} />);
    expect(screen.getByLabelText("Loading stations")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search stations" })).toBeInTheDocument();
  });

  it("shows the error row, whose retry reloads the list", async () => {
    const retryList = vi.fn();
    render(<Harness list={{ status: "error", reason: "failed" }} openStation={openStation} retryList={retryList} />);
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    expect(retryList).toHaveBeenCalled();
  });

  it("announces the full count once loaded", () => {
    render(<Harness list={ready()} openStation={openStation} />);
    expect(screen.getByRole("status")).toHaveTextContent("8 stations");
  });
});

describe("sheet variant", () => {
  it("renders the same header and rows", () => {
    render(<Harness list={ready()} openStation={openStation} variant="sheet" />);
    expect(screen.getByRole("searchbox", { name: "Search stations" })).toHaveAttribute("data-ledger-search");
    expect(screen.getByRole("group", { name: "Filter by line" })).toBeInTheDocument();
    expect(rowSlugs()).toHaveLength(8);
  });
});

describe("tier groups", () => {
  const headings = () => screen.getAllByRole("heading").map((heading) => heading.textContent);

  it("heads the ranked rows with each tier's word and count under the rank sort, ghost first", () => {
    render(<Harness list={ready()} openStation={openStation} />);
    expect(headings()).toEqual([
      "Ghost, 2 stations",
      "Fading, 1 station",
      "Quiet, 1 station",
      "Healthy, 2 stations",
      "Closed, 1 station",
      "No recent data, 1 station",
    ]);
    expect(within(screen.getByRole("list", { name: "Ghost, 2 stations" })).getAllByRole("button")).toHaveLength(2);
    expect(rowSlugs().slice(0, 2)).toEqual(["oak-park-green", "halsted-green"]);
  });

  it("reverses the tiers with the rank order and drops them under another sort", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /^Sort by rank/ }));
    expect(headings().slice(0, 4)).toEqual(["Healthy, 2 stations", "Quiet, 1 station", "Fading, 1 station", "Ghost, 2 stations"]);

    await user.click(screen.getByRole("button", { name: /^Sort by riders/ }));
    expect(screen.queryByRole("heading", { name: /^Ghost/ })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Ranked stations" })).toBeInTheDocument();
  });

  it("counts only the rows a search leaves in each tier", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Search stations" }), "halsted");
    expect(headings()).toEqual(["Ghost, 1 station", "Quiet, 1 station"]);
  });
});

describe("the lede and the foot", () => {
  const lede = () => document.querySelector("[data-ledger-summary]")?.textContent;

  it("says what the list is, then counts the matches while it is narrowed", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    expect(lede()).toBe("8 stations, ranked by Ghost score");

    await userEvent.click(lineToggle("Red"));
    expect(lede()).toBe("7 of 8 stations match");
    expect(screen.getByRole("status")).toHaveTextContent("7 stations match");
  });

  it("names the list before it loads", () => {
    render(<Harness list={{ status: "loading" }} openStation={openStation} />);
    expect(lede()).toBe("L stations, ranked by Ghost score");
  });

  it("states CTA's lag and the data-through date under the rows", () => {
    render(<Harness list={ready()} openStation={openStation} />);
    expect(screen.getByText(/CTA publishes station entries about two months after the fact/)).toBeInTheDocument();
    expect(screen.getByText("2026-07-31")).toHaveAttribute("datetime", "2026-07-31");
  });
});

describe("keyboard reach (R28)", () => {
  it("moves between rows with the arrow keys, Home, and End, across the tier groups and sections", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    act(() => row("oak-park-green").focus());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(row("monroe-red")).toHaveFocus();
    await user.keyboard("{End}");
    expect(row("cicero-pink")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(row("cicero-pink")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(row("oak-park-green")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(row("oak-park-green")).toHaveFocus();
  });

  it("keeps the last focused row as the list's Tab stop, and the selected row before any", () => {
    const { rerender } = render(<Harness list={ready()} openStation={openStation} selectedSlug="monroe-red" />);
    expect(row("monroe-red")).toHaveAttribute("tabindex", "0");
    expect(row("oak-park-green")).toHaveAttribute("tabindex", "-1");

    act(() => row("ohare").focus());
    expect(row("ohare")).toHaveAttribute("tabindex", "0");
    expect(row("monroe-red")).toHaveAttribute("tabindex", "-1");

    rerender(<Harness list={ready()} openStation={openStation} selectedSlug="monroe-red" />);
    expect(row("ohare")).toHaveAttribute("tabindex", "0");
  });

  it("moves across the line filter with the arrow keys, as one Tab stop", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();

    act(() => lineToggle("Red").focus());
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(lineToggle("Brown")).toHaveFocus();
    await user.keyboard("{End}");
    expect(lineToggle("Yellow")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(lineToggle("Red")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(lineToggle("Yellow")).toHaveFocus();
    expect(lineToggle("Yellow")).toHaveAttribute("tabindex", "0");
    expect(lineToggle("Red")).toHaveAttribute("tabindex", "-1");

    await user.keyboard(" ");
    expect(lineToggle("Yellow")).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the cursor in the search on / from anywhere but a field", async () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", { name: "Search stations" });

    act(() => row("oak-park-green").focus());
    await user.keyboard("/");
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");
    await user.keyboard("a/b");
    expect(search).toHaveValue("a/b");
  });

  it("is the skip link's target: the list itself takes focus", () => {
    render(<Harness list={ready()} openStation={openStation} />);
    const list = document.getElementById(LEDGER_LIST_ID);
    expect(list).toHaveAttribute("tabindex", "-1");
    act(() => list?.focus());
    expect(list).toHaveFocus();
  });
});
