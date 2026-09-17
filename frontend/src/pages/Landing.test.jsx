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

  it("shows a hero title, Sign In and Sign Up buttons", () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Attendance/);
    expect(screen.getAllByRole("link", { name: /sign in/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /sign up/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/how it works/i).length).toBeGreaterThan(0);
  });

  it("fetches and displays landing stats cards", async () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>
    );
    expect(await screen.findByText("Students Enrolled")).toBeInTheDocument();
    expect(screen.getByText("Recognition Accuracy")).toBeInTheDocument();
  });
});