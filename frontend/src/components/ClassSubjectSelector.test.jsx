import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import ClassSubjectSelector from "./ClassSubjectSelector";
import { api } from "../api";

vi.mock("../api", () => ({
  api: { get: vi.fn() },
}));

function Harness({ onSelect, includeAllOption }) {
  const [rerender, setRerender] = useState(0);
  return (
    <div>
      <ClassSubjectSelector
        includeAllOption={includeAllOption}
        onSelect={(sel) => onSelect(sel)}
      />
      <button onClick={() => setRerender(rerender + 1)}>rerender</button>
    </div>
  );
}

describe("ClassSubjectSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockReset();
    api.get
      .mockResolvedValueOnce({
        classes: [
          { id: 1, name: "B.Tech CSE", section: "A" },
          { id: 2, name: "B.Tech CSE", section: "B" },
        ],
      })
      .mockResolvedValueOnce({
        subjects: [
          { id: 10, name: "Data Structures", code: "CS301" },
          { id: 11, name: "Algorithms", code: "CS302" },
        ],
      });
  });

  it("loads classes and subjects, then reports the selection", async () => {
    render(<ClassSubjectSelector onSelect={() => {}} includeAllOption />);

    const classSelect = screen.getByLabelText("Class");
    await waitFor(() => {
      expect(classSelect).toHaveValue("");
      expect(screen.getAllByRole("option", { name: /B.Tech CSE/ }).length).toBe(2);
    });

    fireEvent.change(classSelect, { target: { value: "1" } });

    const subjectSelect = screen.getByLabelText("Subject");
    await waitFor(() => {
      expect(subjectSelect).not.toBeDisabled();
      expect(screen.getByRole("option", { name: "Data Structures (CS301)" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Algorithms (CS302)" })).toBeInTheDocument();
    });

    fireEvent.change(subjectSelect, { target: { value: "10" } });

    await waitFor(() => {
      expect(subjectSelect).toHaveValue("10");
    });
    expect(api.get).toHaveBeenCalledWith("/classes");
    expect(api.get).toHaveBeenCalledWith("/classes/1/subjects");
  });

  it("fired onSelect exactly once per change — no duplicate notifications on re-render", async () => {
    const mock = vi.fn();
    render(<Harness onSelect={mock} includeAllOption />);

    const classSelect = screen.getByLabelText("Class");
    await waitFor(() => screen.getByRole("option", { name: /B.Tech CSE — Sec A/ }));

    fireEvent.change(classSelect, { target: { value: "1" } });
    const subjectSelect = screen.getByLabelText("Subject");
    await waitFor(() => expect(screen.getByRole("option", { name: "Algorithms (CS302)" })).toBeInTheDocument());
    fireEvent.change(subjectSelect, { target: { value: "11" } });

    await waitFor(() => expect(subjectSelect).toHaveValue("11"));
    // Mount + class change + subject change = exactly 3 notifications
    expect(mock).toHaveBeenCalledTimes(3);

    // Parent re-renders with a fresh inline onSelect — must NOT add a call
    fireEvent.click(screen.getByText("rerender"));
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("disables the subject select until a class is chosen", () => {
    render(<ClassSubjectSelector onSelect={() => {}} />);
    expect(screen.getByLabelText("Subject")).toBeDisabled();
  });
});