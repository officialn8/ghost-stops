import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineBars } from "./LineBars";
import { PresenceMark } from "./PresenceMark";

describe("PresenceMark", () => {
  it("draws healthy as a solid dot and fading as a hollow ring at 72% ink", () => {
    const { container: healthy } = render(<PresenceMark tier="healthy" />);
    expect(healthy.querySelector("circle")).toHaveAttribute("fill", "currentColor");

    const { container: fading } = render(<PresenceMark tier="fading" />);
    const ring = fading.querySelector("circle");
    expect(ring).toHaveAttribute("fill", "none");
    expect(ring).toHaveAttribute("opacity", "0.72");
  });

  it("draws a ghost-tier station as a ghost, larger than the rings, in the AA-calibrated ink-3", () => {
    const { container } = render(<PresenceMark tier="ghost" size={10} />);
    const ghost = container.querySelector('[data-mark="ghost"]');
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute("width", "15");
    expect(ghost).toHaveAttribute("stroke", "rgb(var(--ink) / var(--ink-3-alpha))");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
  });

  it("crosses a closed station's ring with a bar and dots a no-data ring", () => {
    const { container: closed } = render(<PresenceMark tier={null} excluded="closed" />);
    expect(closed.querySelector("line")).not.toBeNull();

    const { container: noData } = render(<PresenceMark tier={null} excluded="no-data" />);
    expect(noData.querySelector("line")).toBeNull();
    expect(noData.querySelector("circle")).toHaveAttribute("stroke-dasharray", "1 2");
  });
});

describe("LineBars", () => {
  it("draws one bar per line in its official color and names the lines", () => {
    render(<LineBars lines={["Brown", "Purple"]} />);
    const bars = screen.getByRole("img", { name: "Brown, Purple Lines" });
    const colors = [...bars.querySelectorAll("span")].map((bar) => bar.style.backgroundColor);
    expect(colors).toEqual(["rgb(98, 54, 27)", "rgb(82, 35, 152)"]);
  });
});
