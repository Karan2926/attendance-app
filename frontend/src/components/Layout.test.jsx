import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import Layout from "./Layout";
import { useAuth } from "../auth";

vi.mock("../auth", () => ({
  useAuth: vi.fn(),
}));

function renderLayout(role) {
  useAuth.mockImplementation(() => ({
    user: { role, username: "alice" },
    loading: false,
    logout: vi.fn(),
  }));
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>page-body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Layout role-based navigation", () => {
  it("shows only My Attendance for a student", () => {
    renderLayout("student");
    expect(screen.getByText("My Attendance")).toBeInTheDocument();
    expect(screen.queryByText("Mark Attendance")).not.toBeInTheDocument();
    expect(screen.queryByText("Manage System")).not.toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();
  });

  it("shows admin links for an admin", () => {
    renderLayout("admin");
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Manage System")).toBeInTheDocument();
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
    expect(screen.queryByText("Mark Attendance")).not.toBeInTheDocument();
  });

  it("shows teaching links for a teacher", () => {
    renderLayout("teacher");
    expect(screen.getByText("Add Student")).toBeInTheDocument();
    expect(screen.getByText("Mark Attendance")).toBeInTheDocument();
    expect(screen.getByText("Classroom Photo")).toBeInTheDocument();
    expect(screen.getByText("Records")).toBeInTheDocument();
    expect(screen.getByText("AI Copilot")).toBeInTheDocument();
    expect(screen.queryByText("Manage System")).not.toBeInTheDocument();
  });
});