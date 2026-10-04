import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => motion.reduced,
}));

const { CountOnce } = await import("./CountOnce");

const shown = () => document.querySelector("[data-count-once]")!;

describe("CountOnce", () => {
  it("counts up from zero once when it mounts in the browser, and screen readers get the final value only", async () => {
    motion.reduced = false;
    const { rerender } = render(<CountOnce value={1782} />);

    expect(screen.getByText("1,782", { selector: ".sr-only" })).toBeInTheDocument();
    expect(shown()).toHaveAttribute("aria-hidden", "true");
    expect(shown().textContent).not.toBe("1,782");

    await waitFor(() => expect(shown()).toHaveTextContent("1,782"), { timeout: 2000 });

    // A re-render with the same value does not count again.
    rerender(<CountOnce value={1782} />);
    expect(shown()).toHaveTextContent("1,782");
  });

  it("shows the final value at once under reduced motion", () => {
    motion.reduced = true;
    render(<CountOnce value={334} />);
    expect(shown()).toHaveTextContent("334");
  });
});
