import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LEDGER_STATIONS } from "@/components/ledger/__fixtures__/stations";
import { ThemeProvider } from "@/components/theme";
import type { StationListResponse } from "@/types/station";
import { exampleStation, MethodPage } from "./MethodPage";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const list: StationListResponse = { dataThrough: "2026-07-31", lastSuccessfulFetch: null, stations: [...LEDGER_STATIONS] };

const renderPage = (payload: StationListResponse | null) => render(<MethodPage list={payload} />, { wrapper: ThemeProvider });

describe("exampleStation", () => {
  it("picks the first fading station, else the first ranked one, else nothing", () => {
    expect(exampleStation(LEDGER_STATIONS)?.slug).toBe("monroe-red");
    expect(exampleStation(LEDGER_STATIONS.filter((s) => s.tier !== "fading"))?.slug).toBe("oak-park-green");
    expect(exampleStation(LEDGER_STATIONS.filter((s) => s.rank === null))).toBeNull();
  });
});

describe("MethodPage", () => {
  it("annotates a live ledger row with the station's own values, then explains the score, the data, and the API", () => {
    renderPage(list);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("How the Ghost score works");
    expect(screen.getByRole("link", { name: "Ghost Stops: back to the map" })).toHaveAttribute("href", "/");
    expect(screen.getByText("2026-07-31", { selector: "header time" })).toBeInTheDocument();

    // The real row, as a button that opens the station.
    const row = within(screen.getByRole("list", { name: "One row of the ledger" })).getByRole("button");
    expect(row).toHaveAccessibleName("Monroe, Red Line, rank 3 of 6, fading, score 84, 3,723 riders per day");

    // The key quotes the station's values in the row's reading order.
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms.slice(0, 6)).toEqual(["Rank", "Ghost score", "The mark", "Name and lines", "Last week", "Riders per day"]);
    const rowOf = (term: string) => screen.getByText(term, { selector: "dt" }).parentElement;
    expect(rowOf("Rank")).toHaveTextContent("Monroe is 3rd.");
    expect(rowOf("Ghost score")).toHaveTextContent("Monroe scores 84.");
    expect(rowOf("Riders per day")).toHaveTextContent("Monroe averages 3,723.");

    for (const heading of ["The four parts of the score", "Tiers", "Who is ranked", "The data", "The API"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText("Riders against peers")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Who is ranked" }).parentElement).toHaveTextContent(
      "Today 6 of 8 stations are ranked.",
    );
    expect(screen.getByRole("link", { name: /CTA's daily station entries/ })).toHaveAttribute(
      "href",
      expect.stringContaining("5neh-572f"),
    );
    expect(screen.getByText("GET /api/chicago/stations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the map" })).toHaveAttribute("href", "/");

    // The contents line names every section and links to it.
    const contents = within(screen.getByRole("navigation", { name: "On this page" })).getAllByRole("link");
    expect(contents.map((a) => a.getAttribute("href"))).toEqual(["#row", "#sign", "#parts", "#tiers", "#ranked", "#data", "#api"]);
    expect(document.getElementById("parts")).toContainElement(screen.getByRole("heading", { name: "The four parts of the score" }));
  });

  it("lights the part of the row an entry explains while the pointer is on it, and no cell otherwise", async () => {
    renderPage(list);
    const user = userEvent.setup();
    const cell = (name: string) => document.querySelector(`[data-cell="${name}"]`) as HTMLElement;
    for (const name of ["rank", "score", "name", "riders"]) expect(cell(name)).not.toHaveClass("opacity-35");

    await user.hover(screen.getByText("Riders per day", { selector: "dt" }));
    expect(cell("rank")).toHaveClass("opacity-35");
    expect(cell("score")).toHaveClass("opacity-35");
    expect(cell("name")).toHaveClass("opacity-35");
    expect(cell("riders")).not.toHaveClass("opacity-35");

    await user.unhover(screen.getByText("Riders per day", { selector: "dt" }));
    expect(cell("rank")).not.toHaveClass("opacity-35");
  });

  it("stands without a list: no row, the method still explained", () => {
    renderPage(null);
    expect(screen.queryByRole("list", { name: "One row of the ledger" })).toBeNull();
    expect(screen.getByText(/no row to show/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The four parts of the score" })).toBeInTheDocument();
  });
});
