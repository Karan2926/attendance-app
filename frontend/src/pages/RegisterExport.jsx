import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, downloadBlob } from "../api";
import usePageTitle from "../components/usePageTitle";
import ClassSubjectSelector from "../components/ClassSubjectSelector";
import { useAuth } from "../auth";

export default function RegisterExport() {

  usePageTitle('Register Excel');
  const { user } = useAuth();
  const [meta, setMeta] = useState(null);
  const [session, setSession] = useState({ classId: "", subjectId: "" });
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [sessionLabel, setSessionLabel] = useState("");
  const [faculty, setFaculty] = useState(user?.username || "");
  const [branch, setBranch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get("/register_export")
      .then((d) => {
        setMeta(d);
        setMonth(d.current_month || 1);
        setYear(d.current_year || new Date().getFullYear());
      })
      .catch(() => {});
  }, []);

  async function download(e) {
    e.preventDefault();
    if (!session.classId || !session.subjectId) {
      setError("Select class and subject.");
      return;
    }
    setError("");
    setBusy(true);
    const params = new URLSearchParams({
      class_id: session.classId,
      subject_id: session.subjectId,
      year: String(year),
      month: String(month),
    });
    if (sessionLabel) params.set("session", sessionLabel);
    if (faculty) params.set("faculty", faculty);
    if (branch) params.set("branch", branch);
    const fname = `attendance_register_${year}_${String(month).padStart(2, "0")}_c${session.classId}_s${session.subjectId}.xlsx`;
    try {
      await downloadBlob(`/register_export.xlsx?${params.toString()}`, fname);
    } catch (err) {
      setError(err.message || "Failed to build register Excel");
    } finally {
      setBusy(false);
    }
  }

  const monthNames = meta?.month_names || {};

  return (
    <div className="page" style={{ maxWidth: "880px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Higher authority report</span>
          <h1>ITM-style Attendance Register</h1>
        </div>
        <Link to="/attendance_record" className="btn2 btn2-outline">
          Back to Records
        </Link>
      </div>

      <div className="card2 mb-3">
        <span className="eyebrow">How teachers use this</span>
        <h2 className="panel-title">Same idea as the paper register</h2>
        <p className="panel-copy">
          Mark attendance daily in the app (live or classroom photo). Whenever you need the Excel
          sheet — same day or month-end — download this register. It fills{" "}
          <strong>P</strong> marks by date, totals, and percentage like the university register,
          ready to print/sign for Dean / HoD.
        </p>
        <ol className="panel-copy" style={{ margin: "0.5rem 0 0 1.1rem" }}>
          <li>Complete today’s attendance in the app</li>
          <li>Open this page → choose Class, Subject, Month</li>
          <li>Download Excel (grid updates automatically)</li>
          <li>At month end: print, sign, submit to higher command</li>
        </ol>
      </div>

      <div className="card2">
        <span className="eyebrow">Download</span>
        <h2 className="panel-title">Generate monthly register (.xlsx)</h2>
        {error && (
          <div className="mono" style={{ color: "#B91C1C", margin: "0.75rem 0" }}>
            {error}
          </div>
        )}
        <form onSubmit={download} className="mt-3">
          <div className="session-bar" style={{ gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <ClassSubjectSelector onSelect={(s) => setSession(s)} />
            <div>
              <label className="label2">Month</label>
              <select className="input2" value={month} onChange={(e) => setMonth(parseInt(e.target.value))} required>
                {Object.entries(monthNames).map(([m, name]) => (
                  <option key={m} value={m}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label2">Year</label>
              <input
                className="input2"
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                required
              />
            </div>
            <div>
              <label className="label2">Session (optional)</label>
              <input className="input2" value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value)} placeholder="e.g. 2025-26" />
            </div>
            <div>
              <label className="label2">Faculty Incharge (optional)</label>
              <input className="input2" value={faculty} onChange={(e) => setFaculty(e.target.value)} placeholder="Teacher name" />
            </div>
            <div>
              <label className="label2">Branch label (optional)</label>
              <input className="input2" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="e.g. CSE" />
            </div>
          </div>
          <button type="submit" className="btn2 btn2-teal mt-3" disabled={busy}>
            {busy ? "Building…" : "Download Register Excel"}
          </button>
        </form>
      </div>
    </div>
  );
}
