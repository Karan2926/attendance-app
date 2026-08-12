import { useEffect, useState } from "react";
import { api } from "../api";
import usePageTitle from "../components/usePageTitle";
import { useAuth } from "../auth";

export default function MyAttendance() {

  usePageTitle('My Attendance');
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api
      .get("/me/attendance")
      .then(setData)
      .catch(() => {});
  }, []);

  const student = data?.student;
  const records = data?.records || [];

  return (
    <div className="page" style={{ maxWidth: "900px" }}>
      <div className="dash-hero" style={{ gridTemplateColumns: "1.4fr 0.6fr" }}>
        <div className="dash-hero-main">
          <span className="eyebrow">My records</span>
          <h1>{student?.name || "Student"}</h1>
          <p className="mono" style={{ color: "rgba(255,255,255,0.8)" }}>
            Roll: {student?.roll || "-"} · {student?.class || "-"}{" "}
            {student?.section || ""}
          </p>
        </div>
        <div className="dash-stat">
          <span className="eyebrow">Present</span>
          <div className="num">{records.length}</div>
          <div className="mono" style={{ color: "var(--ink-soft)", marginTop: "0.35rem", fontSize: "0.75rem" }}>
            record(s)
          </div>
        </div>
      </div>

      <div className="card2">
        <span className="eyebrow">Attendance history</span>
        <h2 className="panel-title">Your marked sessions</h2>
        <p className="panel-copy">Class and subject shown when available.</p>
        <div className="table-responsive">
          <table className="table2">
            <thead>
              <tr>
                <th>Date &amp; Time (UTC)</th>
                <th>Class</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan="3" className="mono" style={{ color: "var(--ink-soft)" }}>
                    No attendance recorded yet.
                  </td>
                </tr>
              )}
              {records.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.timestamp}</td>
                  <td>
                    {r.class_name || "-"}
                    {r.section ? ` — ${r.section}` : ""}
                  </td>
                  <td>{r.subject_name || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
