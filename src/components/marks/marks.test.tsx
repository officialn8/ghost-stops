import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineBars } from "./LineBars";
import { PresenceMark } from "./PresenceMark";

describe("PresenceMark", () => {
  it("draws healthy as a solid dot and ghost as a dashed ring at 44% ink", () => {
    const { container: healthy } = render(<PresenceMark tier="healthy" />);
    expect(healthy.querySelector("circle")).toHaveAttribute("fill", "currentColor");

    const { container: ghost } = render(<PresenceMark tier="ghost" />);
    const ring = ghost.querySelector("circle");
    expect(ring).toHaveAttribute("fill", "none");
    expect(ring).toHaveAttribute("stroke-dasharray");
    expect(ring).toHaveAttribute("opacity", "0.44");
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
