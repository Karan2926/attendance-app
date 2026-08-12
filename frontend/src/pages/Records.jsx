import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadBlob } from "../api";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";
import EmptyState from "../components/EmptyState";
import ClassSubjectSelector from "../components/ClassSubjectSelector";

export default function Records() {
  const toast = useToast();
  usePageTitle('Records');
  const [filters, setFilters] = useState({ classId: "", subjectId: "" });
  const [period, setPeriod] = useState("all");
  const [records, setRecords] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .get("/classes")
      .then((d) => setClasses(d.classes || []))
      .catch(() => {});
  }, []);

  async function load() {
    const params = new URLSearchParams();
    if (filters.classId) params.set("class_id", filters.classId);
    if (filters.subjectId) params.set("subject_id", filters.subjectId);
    if (period) params.set("period", period);
    try {
      const d = await api.get(`/attendance_records?${params.toString()}`);
      setRecords(d.records || []);
    } catch {}
    setLoaded(true);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.classId, filters.subjectId, period]);

  async function onDelete(id) {
    if (!confirm("Delete this attendance record?")) return;
    try {
      await api.delete(`/attendance_records/${id}`);
      setRecords((prev) => prev.filter((r) => r.id !== id));
      toast.success("Record deleted");
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  }

  function classLabel(r) {
    if (!r.class_name) return "-";
    return r.class_name + (r.section ? ` — ${r.section}` : "");
  }

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">History</span>
          <h1>Attendance Records</h1>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <button className="btn2 btn2-primary" onClick={() => downloadBlob("/attendance_records.csv", "attendance.csv")}>
            Download CSV
          </button>
          <Link to="/register_export" className="btn2 btn2-teal">
            Register Excel
          </Link>
          <Link to="/" className="btn2 btn2-outline">
            Back to dashboard
          </Link>
        </div>
      </div>

      <div className="card2 mb-3">
        <span className="eyebrow">Filters</span>
        <h2 className="panel-title">Narrow the list</h2>
        <p className="panel-copy">Only classes you can access are shown.</p>
        <div className="session-bar" style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}>
          <ClassSubjectSelector onSelect={(s) => setFilters(s)} includeAllOption />
          <div>
            <label className="label2">Period</label>
            <select className="input2" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">All</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div style={{ alignSelf: "end" }}>
            <button className="btn2 btn2-primary w-100" onClick={load}>
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="card2">
        <span className="eyebrow">Results</span>
        <h2 className="panel-title">{records.length} record(s)</h2>
        <div className="table-responsive mt-3">
          <table className="table2">
            <thead>
              <tr>
                <th>ID</th>
                <th>Student</th>
                <th>Photo</th>
                <th>Name</th>
                <th>Class</th>
                <th>Subject</th>
                <th>Timestamp</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!loaded && (
                <tr>
                  <td colSpan="8" className="mono" style={{ color: "var(--ink-soft)" }}>
                    Loading…
                  </td>
                </tr>
              )}
              {loaded && records.length === 0 && (
                <tr>
                  <td colSpan="8">
                    <EmptyState
                      title="No records in this filter"
                      hint="Adjust the filters or mark attendance for this class."
                    />
                  </td>
                </tr>
              )}
              {records.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td className="mono">{r.student_id}</td>
                  <td>
                    <img
                      src={`${import.meta.env.VITE_API_BASE || ""}/api/students/${r.student_id}/photo`}
                      onError={(e) => (e.target.style.display = "none")}
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "1px solid var(--line)",
                      }}
                      alt=""
                    />
                  </td>
                  <td>{r.name}</td>
                  <td>{classLabel(r)}</td>
                  <td>{r.subject_name || "-"}</td>
                  <td className="mono" style={{ color: "var(--ink-soft)" }}>
                    {r.timestamp}
                  </td>
                  <td>
                    <button
                      className="btn2 btn2-danger"
                      style={{ padding: "0.35rem 0.7rem", fontSize: "0.8rem" }}
                      onClick={() => onDelete(r.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
