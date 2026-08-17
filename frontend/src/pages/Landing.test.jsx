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

  it("shows a hero title, Login buttons, and a register link", () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Attendance/);
    expect(screen.getAllByRole("link", { name: "Login" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute("href", "/register");
  });

  it("fetches live stats and labels them", async () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    expect(await screen.findByText("Students enrolled")).toBeInTheDocument();
    expect(screen.getByText("Face embeddings")).toBeInTheDocument();
  });
});