import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";
import EmptyState from "../components/EmptyState";

export default function ManageStudents() {
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [edit, setEdit] = useState(null); // { id, name, roll, reg_no, class_id }
  const [editStatus, setEditStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  usePageTitle("Manage Students");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get("/students");
      setStudents(d.students || []);
    } catch {}
    try {
      const c = await api.get("/classes");
      setClasses(c.classes || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function classLabel(s) {
    const c = classes.find((x) => x.id === s.class_id);
    if (c) return c.name + (c.section ? ` — Sec ${c.section}` : "");
    return s.class ? s.class + (s.section ? ` — Sec ${s.section}` : "") : "—";
  }

  async function onDelete(s) {
    if (
      !confirm(
        `Delete ${s.name}${s.roll ? ` (Roll ${s.roll})` : ""}?\n\nThis removes their attendance records and face data.`
      )
    ) {
      return;
    }
    try {
      await api.delete(`/students/${s.id}`);
      setStudents((prev) => prev.filter((x) => x.id !== s.id));
      toast.success(`Deleted ${s.name}`);
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditStatus("Saving...");
    try {
      await api.put(`/students/${edit.id}`, {
        name: edit.name.trim(),
        roll: edit.roll.trim(),
        reg_no: edit.reg_no.trim(),
        class_id: edit.class_id,
      });
      setEditStatus("Saved. Reloading...");
      setEdit(null);
      load();
    } catch (err) {
      setEditStatus(err.message || "Update failed");
    }
  }

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Student records</span>
          <h1>Manage Students</h1>
          <p className="panel-copy mt-2">
            Edit name, roll no., registration no., class and section. Use Delete to remove
            duplicates.
          </p>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Link to="/add_student" className="btn2 btn2-primary">
            Add Student
          </Link>
          <Link to="/" className="btn2 btn2-outline">
            Dashboard
          </Link>
        </div>
      </div>

      <div className="card2 mb-3">
        <div className="table-responsive">
          <table className="table2">
            <thead>
              <tr>
                <th>Name</th>
                <th>Roll</th>
                <th>Reg. no.</th>
                <th>Class / Section</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!loading && students.length === 0 && (
                <tr>
                  <td colSpan="5">
                    <EmptyState
                      title="No students yet"
                      hint="Add your first student to get started."
                    />
                  </td>
                </tr>
              )}
              {loading && (
                <tr>
                  <td colSpan="5" style={{ textAlign: "center", color: "var(--ink-soft)" }}>
                    Loading students…
                  </td>
                </tr>
              )}
              {students.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="mono">{s.roll || "—"}</td>
                  <td className="mono">{s.reg_no || "—"}</td>
                  <td>{classLabel(s)}</td>
                  <td>
                    <div className="d-flex gap-2 flex-wrap">
                      <button
                        className="btn2 btn2-outline"
                        style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }}
                        onClick={() =>
                          setEdit({
                            id: s.id,
                            name: s.name,
                            roll: s.roll || "",
                            reg_no: s.reg_no || "",
                            class_id: s.class_id ? String(s.class_id) : "",
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="btn2 btn2-danger"
                        style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }}
                        onClick={() => onDelete(s)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="card2">
          <span className="eyebrow">Edit student</span>
          <h2 className="panel-title">Update: {edit.name}</h2>
          <p className="panel-copy">
            Changing class/section moves the student into that class for attendance.
          </p>
          <form onSubmit={saveEdit}>
            <div className="row g-3">
              <div className="col-md-6">
                <label className="label2">Full name</label>
                <input
                  className="input2"
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  required
                />
              </div>
              <div className="col-md-3">
                <label className="label2">Roll no.</label>
                <input
                  className="input2"
                  value={edit.roll}
                  onChange={(e) => setEdit({ ...edit, roll: e.target.value })}
                  placeholder="e.g. 46"
                />
              </div>
              <div className="col-md-3">
                <label className="label2">Registration no.</label>
                <input
                  className="input2"
                  value={edit.reg_no}
                  onChange={(e) => setEdit({ ...edit, reg_no: e.target.value })}
                />
              </div>
              <div className="col-12">
                <label className="label2">Class / Section</label>
                <select
                  className="input2"
                  value={edit.class_id}
                  onChange={(e) => setEdit({ ...edit, class_id: e.target.value })}
                  required
                >
                  <option value="">Select class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.section ? ` — Sec ${c.section}` : ""}
                    </option>
                  ))}
                </select>
                {classes.length === 0 && (
                  <p className="panel-copy mt-2" style={{ color: "#b91c1c" }}>
                    No classes listed. Ask admin to create the class/section and assign you.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 d-flex gap-2 flex-wrap">
              <button type="submit" className="btn2 btn2-primary">
                Save changes
              </button>
              <button type="button" className="btn2 btn2-outline" onClick={() => setEdit(null)}>
                Cancel
              </button>
            </div>
            {editStatus && (
              <div className="mono mt-3" style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                {editStatus}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
