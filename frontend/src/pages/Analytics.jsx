import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import usePageTitle from "../components/usePageTitle";
import ClassSubjectSelector from "../components/ClassSubjectSelector";

function pctPill(pct) {
  if (pct >= 75) return "pill pill-verified";
  if (pct >= 50) return "pill pill-unknown";
  return "pill pill-marked";
}

export default function Analytics() {

  usePageTitle('Analytics');
  const [filters, setFilters] = useState({ classId: "", subjectId: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.classId) params.set("class_id", filters.classId);
    if (filters.subjectId) params.set("subject_id", filters.subjectId);
    api
      .get(`/analytics?${params.toString()}`)
      .then(setData)
      .catch(() => {});
  }, [filters.classId, filters.subjectId]);

  const rows = data?.rows || [];

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Insights</span>
          <h1>Attendance Analytics</h1>
        </div>
        <Link to="/" className="btn2 btn2-outline">
          Back to dashboard
        </Link>
      </div>

      <div className="card2 mb-3">
        <span className="eyebrow">Scope</span>
        <h2 className="panel-title">Filter by class &amp; subject</h2>
        <p className="panel-copy">Percentages use days present since each student was added.</p>
        <div className="session-bar" style={{ gridTemplateColumns: "1fr 1fr auto" }}>
          <ClassSubjectSelector onSelect={(s) => setFilters(s)} includeAllOption />
          <div style={{ alignSelf: "end" }}>
            <button
              className="btn2 btn2-primary"
              onClick={() => {
                const params = new URLSearchParams();
                if (filters.classId) params.set("class_id", filters.classId);
                if (filters.subjectId) params.set("subject_id", filters.subjectId);
                api
                  .get(`/analytics?${params.toString()}`)
                  .then(setData)
                  .catch(() => {});
              }}
            >
              Apply filter
            </button>
          </div>
        </div>
      </div>

      <div className="card2">
        <span className="eyebrow">Class performance</span>
        <h2 className="panel-title">{rows.length ? `${rows.length} student(s)` : "No students"}</h2>
        {rows.length > 0 ? (
          <div className="table-responsive mt-3">
            <table className="table2">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roll</th>
                  <th>Days Present</th>
                  <th>Since</th>
                  <th>Attendance %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="mono">{r.roll}</td>
                    <td className="mono">{r.days_present}</td>
                    <td className="mono" style={{ color: "var(--ink-soft)" }}>
                      {r.total_days} days
                    </td>
                    <td>
                      <span className={pctPill(r.pct)}>{r.pct}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mono mt-3" style={{ color: "var(--ink-soft)" }}>
            No students in the selected scope.
          </p>
        )}
      </div>
    </div>
  );
}
