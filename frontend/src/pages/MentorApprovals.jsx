import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, postFormData } from "../api";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";

export default function MentorApprovals() {
  usePageTitle("Mentor Approvals");
  const toast = useToast();

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [pendingRegs, setPendingRegs] = useState(null);
  const [pendingFilter, setPendingFilter] = useState("pending");
  const [csvVerifying, setCsvVerifying] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Load teacher's assigned classes
  useEffect(() => {
    api
      .get("/classes")
      .then((d) => setClasses(d.classes || []))
      .catch(() => {});
  }, []);

  const loadPending = useCallback(async (statusFilter = pendingFilter) => {
    try {
      const d = await api.get(`/pending_registrations?status=${statusFilter}`);
      setPendingRegs(d.registrations || []);
    } catch {}
  }, [pendingFilter]);

  useEffect(() => {
    loadPending(pendingFilter);
  }, [pendingFilter, loadPending]);

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
      toast.success(`Matched against ${d.csv_rows} section register rows`);
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
      toast.success("Registration approved — student added to section roster");
      loadPending(pendingFilter);
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
    } catch (err) {
      toast.error(err.message || "Bulk approve failed");
    } finally {
      setBulkBusy(false);
    }
  }

  // Filter pending registrations by class if class filter selected
  const filteredRegs = (pendingRegs || []).filter((r) => {
    if (!selectedClassId) return true;
    return String(r.class_id) === String(selectedClassId);
  });

  const pendingCount = filteredRegs.filter((r) => r.status === "pending").length;
  const matchedCount = filteredRegs.filter(
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
          <span className="eyebrow">Section Mentor Portal</span>
          <h1>Section Approvals &amp; CSV Register</h1>
          <p className="panel-copy mt-2">
            Upload your Section's physical Attendance Register CSV (`Roll No.`, `Name of the Student`) to automatically verify &amp; approve pending student self-registrations.
          </p>
        </div>
        <Link to="/" className="btn2 btn2-outline">
          Back to Dashboard
        </Link>
      </div>

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
            <label className="label2">Reason (for section records)</label>
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

      {/* Class Section Filter Bar */}
      <div className="card2 mb-4">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <span className="eyebrow">Class Section Filter</span>
            <h2 className="panel-title" style={{ margin: 0 }}>Select Your Assigned Section</h2>
          </div>
          <div style={{ minWidth: 260 }}>
            <select
              className="input2"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
            >
              <option value="">All My Assigned Sections ({pendingCount} pending)</option>
              {classes.map((c) => {
                const count = (pendingRegs || []).filter(
                  (r) => r.status === "pending" && String(r.class_id) === String(c.id)
                ).length;
                return (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.section ? `— Sec ${c.section}` : ""} ({count} pending)
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <div className="workspace-split" style={{ gap: "1.5rem" }}>
        {/* Step 1: Upload Section Register CSV */}
        <div className="card2" style={{ flex: "0 0 340px" }}>
          <span className="eyebrow">Step 1</span>
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
            <div style={{ fontSize: "2.2rem", marginBottom: "0.5rem" }}>📋</div>
            <div className="panel-copy" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
              ITM Register CSV Format:<br />
              <span className="mono" style={{ fontSize: "0.78rem", color: "var(--teal)", fontWeight: 700 }}>
                Roll No. · Name of the Student
              </span>
            </div>
            <label className="btn2 btn2-teal" style={{ cursor: "pointer", display: "inline-block" }}>
              {csvVerifying ? "Verifying…" : "📂 Choose Section CSV"}
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
            <button className="btn2 btn2-primary w-100" onClick={handleBulkApprove} disabled={bulkBusy}>
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
                <span className="eyebrow">Step 2</span>
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
            {pendingRegs && filteredRegs.length === 0 && (
              <div className="mono" style={{ color: "var(--ink-soft)", padding: "1.5rem 0", textAlign: "center" }}>
                No {pendingFilter} registrations for this section.
              </div>
            )}
            {pendingRegs && filteredRegs.length > 0 && (
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
                    {filteredRegs.map((r) => (
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
    </div>
  );
}
