import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Login from "./Login";
import { AuthProvider } from "../auth";

vi.mock("../api", () => ({
  logout: vi.fn(),
  fetchMe: vi.fn(),
  login: vi.fn(),
  api: { get: vi.fn() },
}));

import { login as apiLogin } from "../api";

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>home-dashboard</div>} />
          <Route path="/my_attendance" element={<div>my-attendance-page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs in a teacher and navigates to the dashboard", async () => {
    apiLogin.mockResolvedValue({ user: { role: "teacher", username: "proff" } });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "proff");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Log In" }));

    expect(apiLogin).toHaveBeenCalledWith("proff", "secret");
    expect(await screen.findByText("home-dashboard")).toBeInTheDocument();
  });

  it("routes students to My Attendance", async () => {
    apiLogin.mockResolvedValue({ user: { role: "student", username: "stu1" } });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "stu1");
    await user.type(screen.getByLabelText("Password"), "pw");
    await user.click(screen.getByRole("button", { name: "Log In" }));

    expect(await screen.findByText("my-attendance-page")).toBeInTheDocument();
  });

  it("shows the error message on invalid credentials", async () => {
    apiLogin.mockRejectedValue(new Error("Invalid username or password"));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "nobody");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log In" }));

    expect(await screen.findByText("Invalid username or password")).toBeInTheDocument();
    expect(screen.queryByText("home-dashboard")).not.toBeInTheDocument();
  });
});