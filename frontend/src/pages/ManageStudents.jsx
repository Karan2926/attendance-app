import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, postFormData } from "../api";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";
import EmptyState from "../components/EmptyState";

export default function ManageStudents() {
  const [activeTab, setActiveTab] = useState("roster"); // "roster" | "approvals"
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [edit, setEdit] = useState(null); // { id, name, roll, reg_no, class_id }
  const [editStatus, setEditStatus] = useState("");
  const [loading, setLoading] = useState(true);

  // Pending Approvals state
  const [pendingRegs, setPendingRegs] = useState(null);
  const [pendingFilter, setPendingFilter] = useState("pending");
  const [csvVerifying, setCsvVerifying] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

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

  const loadPending = useCallback(async (statusFilter = pendingFilter) => {
    try {
      const d = await api.get(`/pending_registrations?status=${statusFilter}`);
      setPendingRegs(d.registrations || []);
    } catch {}
  }, [pendingFilter]);

  useEffect(() => {
    load();
    loadPending("pending");
  }, [load, loadPending]);

  useEffect(() => {
    if (activeTab === "approvals") loadPending(pendingFilter);
  }, [activeTab, pendingFilter, loadPending]);

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

  // Pending approval handlers
  async function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvVerifying(true);
    setCsvResult(null);
    try {
      const fd = new FormData();
      fd.append("csv", file);
      const d = await postFormData("/pending_registrations/verify_csv", fd);
      setPendingRegs(d.registrations || []);
      setCsvResult({ csv_rows: d.csv_rows });
      toast.success(`Matched against ${d.csv_rows} register rows`);
    } catch (err) {
      toast.error(err.message || "CSV verification failed");
    } finally {
      setCsvVerifying(false);
      e.target.value = "";
    }
  }

  async function handleApprove(id) {
    try {
      await api.post(`/pending_registrations/${id}/approve`, {});
      toast.success("Registration approved — student added to roster");
      loadPending(pendingFilter);
      load();
    } catch (err) {
      toast.error(err.message || "Approval failed");
    }
  }

  async function handleRejectSubmit() {
    if (!rejectModal) return;
    try {
      await api.post(`/pending_registrations/${rejectModal.id}/reject`, { reason: rejectReason });
      toast.success(`Rejected ${rejectModal.name}`);
      setRejectModal(null);
      setRejectReason("");
      loadPending(pendingFilter);
    } catch (err) {
      toast.error(err.message || "Rejection failed");
    }
  }

  async function handleBulkApprove() {
    setBulkBusy(true);
    try {
      const d = await api.post("/pending_registrations/bulk_approve", {});
      toast.success(`Bulk approved ${d.approved} / ${d.total} registration(s)`);
      loadPending(pendingFilter);
      load();
    } catch (err) {
      toast.error(err.message || "Bulk approve failed");
    } finally {
      setBulkBusy(false);
    }
  }

  const pendingCount = (pendingRegs || []).filter((r) => r.status === "pending").length;
  const matchedCount = (pendingRegs || []).filter(
    (r) => r.status === "pending" && (r.csv_match_status === "exact" || r.csv_match_status === "fuzzy")
  ).length;

  const matchBadge = (status) => {
    if (status === "exact") return <span className="mono" style={{ color: "#059669", fontWeight: 700, fontSize: "0.78rem" }}>✅ Exact Match</span>;
    if (status === "fuzzy") return <span className="mono" style={{ color: "#D97706", fontWeight: 700, fontSize: "0.78rem" }}>🟡 Name Match</span>;
    if (status === "none") return <span className="mono" style={{ color: "#DC2626", fontWeight: 700, fontSize: "0.78rem" }}>🔴 Unmatched</span>;
    return <span className="mono" style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>⬜ Not Verified</span>;
  };

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Student records &amp; Section Mentor portal</span>
          <h1>Manage Students</h1>
          <p className="panel-copy mt-2">
            Roster management, pending self-registrations, and Section Register CSV verification.
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

      {/* Sub-tabs */}
      <div className="step-rail mb-3">
        <button
          className={`step-chip${activeTab === "roster" ? " active" : ""}`}
          onClick={() => setActiveTab("roster")}
        >
          Student Roster ({students.length})
        </button>
        <button
          className={`step-chip${activeTab === "approvals" ? " active" : ""}`}
          onClick={() => setActiveTab("approvals")}
        >
          Pending Approvals &amp; CSV Register
          {pendingCount > 0 && (
            <span
              style={{
                marginLeft: "0.4rem",
                background: "#EF4444",
                color: "#fff",
                borderRadius: "9999px",
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0 6px",
                lineHeight: "1.4",
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* ── TAB 1: Student Roster ─────────────────────────────────────── */}
      {activeTab === "roster" && (
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
                        hint="Add your first student or approve pending registrations."
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
      )}

      {/* ── TAB 2: Pending Approvals & CSV Register ─────────────────────── */}
      {activeTab === "approvals" && (
        <>
          {/* Reject modal */}
          {rejectModal && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}
            >
              <div className="card2" style={{ maxWidth: 440, width: "100%", margin: "1rem" }}>
                <span className="eyebrow" style={{ color: "#DC2626" }}>Reject Registration</span>
                <h3 style={{ margin: "0.5rem 0 1rem" }}>Rejecting: {rejectModal.name}</h3>
                <label className="label2">Reason (for records)</label>
                <textarea
                  className="input2 mb-3"
                  rows={3}
                  placeholder="e.g. Not found in Section Register, roll number mismatch…"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="d-flex gap-2">
                  <button
                    className="btn2 btn2-outline"
                    style={{ flex: 1 }}
                    onClick={() => {
                      setRejectModal(null);
                      setRejectReason("");
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn2"
                    style={{ flex: 1, background: "#DC2626", color: "#fff", border: "none" }}
                    onClick={handleRejectSubmit}
                  >
                    Confirm Reject
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="workspace-split" style={{ gap: "1.5rem" }}>
            {/* Step 1: Upload Section Register CSV */}
            <div className="card2" style={{ flex: "0 0 320px" }}>
              <span className="eyebrow">Section Mentor Step 1</span>
              <h2 className="panel-title">Upload Section Register</h2>
              <p className="panel-copy">
                Upload your Section's physical Attendance Register CSV. The system auto-matches
                pending student self-registrations by Roll No. and Name.
              </p>

              <div
                style={{
                  border: "2px dashed var(--line)",
                  borderRadius: "var(--radius)",
                  padding: "1.5rem",
                  textAlign: "center",
                  background: "#FAFAFA",
                  marginBottom: "1rem",
                }}
              >
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📋</div>
                <div className="panel-copy" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  ITM Register CSV:<br />
                  <span className="mono" style={{ fontSize: "0.78rem", color: "var(--teal)" }}>
                    Roll No. · Name of the Student
                  </span>
                </div>
                <label className="btn2 btn2-outline" style={{ cursor: "pointer", display: "inline-block" }}>
                  {csvVerifying ? "Verifying…" : "📂 Choose CSV File"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    style={{ display: "none" }}
                    onChange={handleCsvUpload}
                    disabled={csvVerifying}
                  />
                </label>
              </div>

              {csvResult && (
                <div className="mono" style={{ fontSize: "0.8rem", color: "var(--teal)", marginBottom: "1rem" }}>
                  ✓ Verified against {csvResult.csv_rows} section register rows
                </div>
              )}

              {matchedCount > 0 && (
                <button className="btn2 btn2-teal w-100" onClick={handleBulkApprove} disabled={bulkBusy}>
                  {bulkBusy ? "Approving…" : `✅ Approve All ${matchedCount} Matched`}
                </button>
              )}
            </div>

            {/* Step 2: Review & Approve Table */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="card2">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    marginBottom: "1rem",
                  }}
                >
                  <div>
                    <span className="eyebrow">Section Mentor Step 2</span>
                    <h2 className="panel-title" style={{ margin: 0 }}>Review &amp; Approve Roster</h2>
                  </div>
                  <div className="d-flex gap-2" style={{ flexWrap: "wrap" }}>
                    {["pending", "approved", "rejected", "all"].map((f) => (
                      <button
                        key={f}
                        className={`btn2 btn2-outline${pendingFilter === f ? " active" : ""}`}
                        style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                        onClick={() => setPendingFilter(f)}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {!pendingRegs && <div className="mono" style={{ color: "var(--ink-soft)" }}>Loading…</div>}
                {pendingRegs && pendingRegs.length === 0 && (
                  <div className="mono" style={{ color: "var(--ink-soft)" }}>
                    No {pendingFilter} registrations for your assigned section.
                  </div>
                )}
                {pendingRegs && pendingRegs.length > 0 && (
                  <div className="table-responsive">
                    <table className="table2">
                      <thead>
                        <tr>
                          <th>Name &amp; Roll</th>
                          <th>Section</th>
                          <th>Photos</th>
                          <th>CSV Match</th>
                          <th>Submitted</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingRegs.map((r) => (
                          <tr key={r.id} style={r.status !== "pending" ? { opacity: 0.6 } : undefined}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{r.name}</div>
                              <div className="mono" style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>
                                {r.roll}
                                {r.reg_no ? ` · ${r.reg_no}` : ""}
                              </div>
                              <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                                @{r.username}
                              </div>
                            </td>
                            <td className="mono" style={{ fontSize: "0.85rem" }}>
                              {r.class_label || "—"}
                            </td>
                            <td className="mono" style={{ fontSize: "0.85rem" }}>
                              {r.face_sample_count}
                            </td>
                            <td>
                              {matchBadge(r.csv_match_status)}
                              {r.csv_match_detail && (
                                <div
                                  className="mono"
                                  style={{ fontSize: "0.7rem", color: "var(--ink-soft)", marginTop: "0.2rem" }}
                                >
                                  {r.csv_match_detail.name || ""}
                                  {r.csv_match_detail._similarity
                                    ? ` (${Math.round(r.csv_match_detail._similarity * 100)}%)`
                                    : ""}
                                </div>
                              )}
                            </td>
                            <td
                              className="mono"
                              style={{ fontSize: "0.75rem", color: "var(--ink-soft)", whiteSpace: "nowrap" }}
                            >
                              {r.submitted_at ? r.submitted_at.slice(0, 10) : ""}
                            </td>
                            <td>
                              {r.status === "pending" && (
                                <div className="d-flex gap-1">
                                  <button
                                    className="btn2 btn2-teal"
                                    style={{ padding: "0.3rem 0.75rem", fontSize: "0.78rem" }}
                                    onClick={() => handleApprove(r.id)}
                                  >
                                    ✓ Approve
                                  </button>
                                  <button
                                    className="btn2 btn2-outline"
                                    style={{
                                      padding: "0.3rem 0.6rem",
                                      fontSize: "0.78rem",
                                      color: "#DC2626",
                                      borderColor: "#DC2626",
                                    }}
                                    onClick={() => {
                                      setRejectModal({ id: r.id, name: r.name });
                                      setRejectReason("");
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              )}
                              {r.status === "approved" && (
                                <span
                                  className="mono"
                                  style={{ color: "#059669", fontSize: "0.8rem", fontWeight: 600 }}
                                >
                                  Approved
                                </span>
                              )}
                              {r.status === "rejected" && (
                                <span
                                  className="mono"
                                  style={{ color: "#DC2626", fontSize: "0.8rem", fontWeight: 600 }}
                                  title={r.reject_reason}
                                >
                                  Rejected
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Edit Student Modal */}
      {edit && (
        <div className="card2 mt-3">
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

