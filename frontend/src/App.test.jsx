import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import { useAuth } from "./auth";
import { ToastProvider } from "./components/Toast";

vi.mock("../api", () => ({
  logout: vi.fn(),
  fetchMe: vi.fn(),
  login: vi.fn(),
  api: { get: vi.fn().mockResolvedValue({}) },
}));

vi.mock("./auth", () => ({
  useAuth: vi.fn(),
}));

function renderApp() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>
    </ToastProvider>
  );
}

describe("HomeGate routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Landing page to visitors (Login button, not the dashboard)", () => {
    useAuth.mockReturnValue({ user: null, loading: false });
    renderApp();
    expect(screen.getByRole("link", { name: "Login" })).toBeInTheDocument();
    expect(screen.queryByText("Mark Attendance")).not.toBeInTheDocument();
  });

  it("shows the dashboard inside the app layout for a signed-in teacher", () => {
    useAuth.mockReturnValue({
      user: { role: "teacher", username: "proff" },
      loading: false,
      logout: vi.fn(),
    });
    renderApp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Digital Attendance");
    expect(screen.getAllByText("Mark Attendance").length).toBeGreaterThan(0);
    expect(screen.getByText("Run today’s flow")).toBeInTheDocument();
  });
});