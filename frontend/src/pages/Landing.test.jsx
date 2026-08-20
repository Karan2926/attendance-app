import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Landing from "./Landing";

vi.mock("../api", () => ({
  api: { get: vi.fn().mockResolvedValue({}) },
}));

describe("Landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a hero title and Login buttons, with no student-facing registration", () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Attendance/);
    expect(screen.getAllByRole("link", { name: "Login" }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole("link", { name: /sign up|register|create.*account/i })).toHaveLength(0);
    expect(screen.getAllByRole("link", { name: /see how it works/i }).length).toBeGreaterThan(0);
  });

  it("fetches live stats and labels them", async () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    expect(await screen.findByText("Students enrolled")).toBeInTheDocument();
    expect(screen.getByText("Attendance today")).toBeInTheDocument();
  });
});