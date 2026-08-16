import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, postFormData } from "../api";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "teachers", label: "Teachers" },
  { id: "classes", label: "Classes & access" },
  { id: "settings", label: "Settings" },
  { id: "health", label: "Health" },
  { id: "audit", label: "Audit log" },
];

function StatCard({ label, value, hint }) {
  return (
    <div className="card2 text-center" style={{ padding: "1rem" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "1.8rem", fontWeight: 700, color: "var(--navy)" }}>
        {value}
      </div>
      <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
        {label}
      </div>
      {hint && (
        <div className="mono" style={{ fontSize: "0.7rem", color: "var(--ink-soft)", marginTop: "0.2rem" }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  const toast = useToast();
  usePageTitle("Admin");
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") || "overview");

  const selectTab = (id) => {
    setTab(id);
    setSearchParams(id === "overview" ? {} : { tab: id }, { replace: true });
  };

  // Keep the tab in sync with the URL (e.g. nav link to /admin?tab=audit)
  useEffect(() => {
    setTab(searchParams.get("tab") || "overview");
  }, [searchParams]);

  const [overview, setOverview] = useState(null);
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [audit, setAudit] = useState(null);
  const [health, setHealth] = useState(null);

  const [newTeacher, setNewTeacher] = useState({ full_name: "", username: "", password: "" });
  const [draft, setDraft] = useState({});

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await api.get("/admin/overview"));
    } catch {}
  }, []);
  const loadStats = useCallback(async () => {
    try {
      setStats(await api.get("/admin/system_stats"));
    } catch {}
  }, []);
  const loadSettings = useCallback(async () => {
    try {
      const d = await api.get("/admin/settings");
      setSettings(d);
      setDraft(Object.fromEntries(d.settings.map((s) => [s.key, s.value])));
    } catch {}
  }, []);
  const loadAudit = useCallback(async () => {
    try {
      setAudit(await api.get("/admin/audit"));
    } catch {}
  }, []);
  const loadHealth = useCallback(async () => {
    try {
      setHealth(await api.get("/admin/system_health"));
    } catch {}
  }, []);

  useEffect(() => {
    loadOverview();
    loadStats();
  }, [loadOverview, loadStats]);

  useEffect(() => {
    if (tab === "settings") loadSettings();
  }, [tab, loadSettings]);

  useEffect(() => {
    if (tab === "audit") loadAudit();
  }, [tab, loadAudit]);

  useEffect(() => {
    if (tab === "health") loadHealth();
  }, [tab, loadHealth]);

  useEffect(() => {
    if (tab === "teachers") loadStats();
  }, [tab, loadStats]);

  async function createTeacher(e) {
    e.preventDefault();
    try {
      await api.post("/teachers", newTeacher);
      setNewTeacher({ full_name: "", username: "", password: "" });
      toast.success("Teacher created");
      loadOverview();
      loadStats();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function toggleTeacher(t) {
    try {
      await api.put(`/teachers/${t.id}`, { active: !t.is_active });
      toast.success(t.is_active ? "Teacher deactivated" : "Teacher activated");
      loadStats();
      loadOverview();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteTeacher(t) {
    if (!window.confirm(`Permanently delete teacher "${t.username}"? Their class assignments will be removed.`)) return;
    try {
      await api.delete(`/teachers/${t.id}/delete`);
      toast.success("Teacher deleted");
      loadStats();
      loadOverview();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function saveSettings() {
    try {
      const res = await api.post("/admin/settings/update", { settings: draft });
      toast.success(`Saved ${res.updated.length} setting(s)`);
      loadSettings();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function retrainNow() {
    try {
      const res = await postFormData("/train_model", new FormData());
      toast.success(res.status === "already_running" ? "Training already running" : "Training started");
    } catch (err) {
      toast.error(err.message || "Training could not be started");
    }
  }

  const classes = overview?.classes || [];
  const teachers = overview?.teachers || [];
  const assignments = overview?.assignments || [];
  const subjects = overview?.subjects || [];

  const teacherList = useMemo(() => {
    const m = new Map((stats?.per_teacher || []).map((t) => [t.id, t]));
    return teachers.map((t) => ({ ...t, ...(m.get(t.id) || {}) }));
  }, [teachers, stats]);

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Admin console</span>
          <h1>System Management</h1>
          <p className="panel-copy mt-2">
            Structure, access and oversight. Attendance marking happens on the
            teacher side.
          </p>
        </div>
        <Link to="/" className="btn2 btn2-outline">
          Back to dashboard
        </Link>
      </div>

      <div className="step-rail">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`step-chip${tab === t.id ? " active" : ""}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="row g-4">
          <div className="col-lg-3">
            <StatCard label="Students" value={stats?.students ?? "—"} />
          </div>
          <div className="col-lg-3">
            <StatCard label="Teachers" value={stats?.teachers ?? "—"} hint={`${stats?.teachers_active ?? 0} active`} />
          </div>
          <div className="col-lg-3">
            <StatCard label="Classes" value={stats?.classes ?? "—"} hint={`${stats?.subjects ?? 0} subjects`} />
          </div>
          <div className="col-lg-3">
            <StatCard label="Attendance today" value={stats?.attendance_today ?? "—"} hint={`${stats?.attendance_7d ?? 0} in 7 days`} />
          </div>

          <div className="col-lg-6">
            <div className="card2">
              <span className="eyebrow">Teachers</span>
              <div className="table-responsive">
                <table className="table2">
                  <thead>
                    <tr>
                      <th>Teacher</th>
                      <th>Status</th>
                      <th>Classes</th>
                      <th>Marked today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.per_teacher?.length === 0 && (
                      <tr><td colSpan={4} className="mono" style={{ color: "var(--ink-soft)" }}>No teachers yet</td></tr>
                    )}
                    {stats?.per_teacher?.map((t) => (
                      <tr key={t.id}>
                        <td>{t.full_name ? `${t.full_name} (${t.username})` : t.username}</td>
                        <td>
                          <span className="mono" style={{ color: t.is_active ? "var(--navy)" : "var(--amber)" }}>
                            {t.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>{t.class_count}</td>
                        <td>{t.records_today}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="col-lg-6">
            <div className="card2">
              <span className="eyebrow">Classes</span>
              <div className="table-responsive">
                <table className="table2">
                  <thead>
                    <tr>
                      <th>Class</th>
                      <th>Students</th>
                      <th>Marked today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats?.per_class?.length === 0 && (
                      <tr><td colSpan={3} className="mono" style={{ color: "var(--ink-soft)" }}>No classes yet</td></tr>
                    )}
                    {stats?.per_class?.map((c) => (
                      <tr key={c.id}>
                        <td>{c.label}</td>
                        <td>{c.student_count}</td>
                        <td>{c.records_today}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "teachers" && (
        <div className="row g-4">
          <div className="col-lg-4">
            <div className="card2">
              <span className="eyebrow">Create teacher</span>
              <form onSubmit={createTeacher} className="mt-2">
                <label className="label2">Full name</label>
                <input
                  className="input2 mb-2"
                  value={newTeacher.full_name}
                  onChange={(e) => setNewTeacher({ ...newTeacher, full_name: e.target.value })}
                  placeholder="Prof. Sharma"
                />
                <label className="label2">Username</label>
                <input
                  className="input2 mb-2"
                  value={newTeacher.username}
                  onChange={(e) => setNewTeacher({ ...newTeacher, username: e.target.value })}
                  required
                />
                <label className="label2">Password</label>
                <input
                  className="input2 mb-3"
                  type="password"
                  value={newTeacher.password}
                  onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })}
                  required
                />
                <button className="btn2 btn2-teal w-100" type="submit">
                  Create teacher
                </button>
              </form>
              <div className="mt-3 mono" style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>
                Tip: after creating a teacher, use "Classes &amp; access" to assign
                them their class + subject — otherwise they won't see any students.
              </div>
            </div>
          </div>

          <div className="col-lg-8">
            <div className="card2">
              <span className="eyebrow">Teacher accounts</span>
              <div className="table-responsive">
                <table className="table2">
                  <thead>
                    <tr>
                      <th>Teacher</th>
                      <th>Status</th>
                      <th>Classes</th>
                      <th>Today</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {teacherList.length === 0 && (
                      <tr><td colSpan={5} className="mono" style={{ color: "var(--ink-soft)" }}>No teachers yet</td></tr>
                    )}
                    {teacherList.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {t.full_name ? `${t.full_name} (${t.username})` : t.username}
                          <div className="mono" style={{ fontSize: "0.72rem", color: "var(--ink-soft)" }}>
                            #{t.id} · joined {String(t.created_at || "").slice(0, 10)}
                          </div>
                        </td>
                        <td>
                          <span className="mono" style={{ color: t.is_active ? "var(--navy)" : "var(--amber)" }}>
                            {t.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>{t.class_count}</td>
                        <td>{t.records_today}</td>
                        <td className="text-end">
                          <button className="btn2 btn2-outline btn-sm me-1" onClick={() => toggleTeacher(t)}>
                            {t.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button className="btn2 btn2-outline btn-sm" onClick={() => deleteTeacher(t)}>
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
        </div>
      )}

      {tab === "classes" && (
        <ClassAccessTab
          overview={overview}
          classes={classes}
          subjects={subjects}
          teachers={teachers}
          assignments={assignments}
          onChanged={loadOverview}
          toast={toast}
        />
      )}

      {tab === "settings" && (
        <div className="row g-4">
          <div className="col-lg-7">
            <div className="card2">
              <span className="eyebrow">Recognition sensitivity</span>
              <h5 style={{ margin: "0 0 0.25rem" }}>Confidence thresholds</h5>
              <p className="panel-copy">
                These control how strictly faces are matched. Raise them to reduce
                wrong matches, lower them to recognise more faces.
              </p>
              {!settings && <div className="mono" style={{ color: "var(--ink-soft)" }}>Loading…</div>}
              {settings?.settings?.map((s) => (
                <div key={s.key} className="mb-3">
                  <label className="label2">
                    {s.label}{" "}
                    <span className="mono" style={{ color: "var(--ink-soft)", fontSize: "0.72rem" }}>
                      (default {s.default})
                    </span>
                  </label>
                  <input
                    type="number"
                    className="input2"
                    step={s.step}
                    min={s.min}
                    max={s.max}
                    value={draft[s.key] ?? s.value}
                    onChange={(e) => setDraft((p) => ({ ...p, [s.key]: e.target.value }))}
                  />
                  <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)", marginTop: "0.25rem" }}>
                    {s.hint}
                  </div>
                </div>
              ))}
              <div className="d-flex gap-2 mt-3">
                <button className="btn2 btn2-primary" onClick={saveSettings} disabled={!settings}>
                  Save settings
                </button>
                <button className="btn2 btn2-outline" onClick={retrainNow} disabled={!settings}>
                  Retrain model now
                </button>
              </div>
            </div>
          </div>
          <div className="col-lg-5">
            <div className="card2">
              <span className="eyebrow">How it works</span>
              <h5 style={{ margin: "0 0 0.5rem" }}>Thresholds in plain words</h5>
              <ul style={{ paddingLeft: "1.1rem", lineHeight: 1.7 }}>
                <li>
                  <strong>Live mark</strong> — the similarity needed to instantly mark a
                  student present in webcam mode. Too low and wrong people get marked.
                </li>
                <li>
                  <strong>Classroom match</strong> — used when scanning a photo of the
                  whole room. Lower recognises more faces from far away.
                </li>
                <li>
                  <strong>Needs review cutoff</strong> — weaker matches are flagged for a
                  teacher to double-check before saving.
                </li>
              </ul>
              <p className="panel-copy mt-3" style={{ marginBottom: 0 }}>
                After changing thresholds, no re-training is required — they apply
                immediately to new recognition requests.
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "health" && <HealthTab health={health} onRefresh={loadHealth} />}

      {tab === "audit" && (
        <div className="card2">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <span className="eyebrow">Audit trail</span>
              <h5 style={{ margin: 0 }}>Recent system actions</h5>
            </div>
            <button className="btn2 btn2-outline btn-sm" onClick={loadAudit}>
              Refresh
            </button>
          </div>
          <div className="table-responsive mt-3">
            <table className="table2">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit && audit.logs.length === 0 && (
                  <tr><td colSpan={5} className="mono" style={{ color: "var(--ink-soft)" }}>No actions recorded yet</td></tr>
                )}
                {(audit?.logs || []).map((l) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ fontSize: "0.78rem" }}>{String(l.created_at || "").replace("T", " ").slice(0, 19)}</td>
                    <td>{l.actor || "system"}</td>
                    <td className="mono">{l.action}</td>
                    <td>{l.target || "—"}</td>
                    <td className="mono" style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>{l.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ClassAccessTab({ overview, classes, subjects, teachers, assignments, onChanged, toast }) {
  const [newClass, setNewClass] = useState({ name: "", section: "", academic_year: "" });
  const [newSubject, setNewSubject] = useState({ class_id: "", name: "", code: "" });
  const [newAssign, setNewAssign] = useState({ user_id: "", class_id: "", subject_id: "" });
  const [assignSubjects, setAssignSubjects] = useState([]);

  async function createClass(e) {
    e.preventDefault();
    try {
      await api.post("/classes", {
        name: newClass.name,
        section: newClass.section,
        academic_year: newClass.academic_year,
      });
      setNewClass({ name: "", section: "", academic_year: "" });
      toast.success("Class created");
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function createSubject(e) {
    e.preventDefault();
    try {
      await api.post(`/classes/${newSubject.class_id}/subjects`, {
        name: newSubject.name,
        code: newSubject.code,
      });
      setNewSubject({ class_id: newSubject.class_id, name: "", code: "" });
      toast.success("Subject created");
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function onAssignClassChange(e) {
    const classId = e.target.value;
    setNewAssign((prev) => ({ ...prev, class_id: classId, subject_id: "" }));
    setAssignSubjects([]);
    if (!classId) return;
    try {
      const d = await api.get(`/classes/${classId}/subjects`);
      setAssignSubjects(d.subjects || []);
    } catch {}
  }

  async function assignTeacher(e) {
    e.preventDefault();
    try {
      await api.post("/assignments", {
        user_id: newAssign.user_id,
        class_id: newAssign.class_id,
        subject_id: newAssign.subject_id,
      });
      setNewAssign({ user_id: "", class_id: "", subject_id: "" });
      setAssignSubjects([]);
      toast.success("Teacher assigned");
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="row g-4">
      <div className="col-lg-4">
        <div className="card2">
          <span className="eyebrow">Create class</span>
          <form onSubmit={createClass} className="mt-2">
            <label className="label2">Name</label>
            <input className="input2 mb-2" value={newClass.name} onChange={(e) => setNewClass({ ...newClass, name: e.target.value })} placeholder="B.Tech CSE" required />
            <label className="label2">Section</label>
            <input className="input2 mb-2" value={newClass.section} onChange={(e) => setNewClass({ ...newClass, section: e.target.value })} placeholder="A" />
            <label className="label2">Academic year</label>
            <input className="input2 mb-3" value={newClass.academic_year} onChange={(e) => setNewClass({ ...newClass, academic_year: e.target.value })} placeholder="2025-26" />
            <button className="btn2 btn2-primary w-100" type="submit">Add class</button>
          </form>
        </div>

        <div className="card2 mt-4">
          <span className="eyebrow">Create subject</span>
          <form onSubmit={createSubject} className="mt-2">
            <label className="label2">Class</label>
            <select className="input2 mb-2" value={newSubject.class_id} onChange={(e) => setNewSubject({ ...newSubject, class_id: e.target.value })} required>
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.section ? ` — Sec ${c.section}` : ""}
                </option>
              ))}
            </select>
            <label className="label2">Subject name</label>
            <input className="input2 mb-2" value={newSubject.name} onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })} placeholder="Data Structures" required />
            <label className="label2">Code</label>
            <input className="input2 mb-3" value={newSubject.code} onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })} placeholder="DS101" />
            <button className="btn2 btn2-primary w-100" type="submit">Add subject</button>
          </form>
        </div>
      </div>

      <div className="col-lg-4">
        <div className="card2">
          <span className="eyebrow">Assign teacher</span>
          <form onSubmit={assignTeacher} className="mt-2">
            <label className="label2">Teacher</label>
            <select className="input2 mb-2" value={newAssign.user_id} onChange={(e) => setNewAssign({ ...newAssign, user_id: e.target.value })} required>
              <option value="">Select teacher</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.username}
                  {t.full_name ? ` (${t.full_name})` : ""}
                </option>
              ))}
            </select>
            <label className="label2">Class</label>
            <select className="input2 mb-2" value={newAssign.class_id} onChange={onAssignClassChange} required>
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.section ? ` — Sec ${c.section}` : ""}
                </option>
              ))}
            </select>
            <label className="label2">Subject</label>
            <select className="input2 mb-3" value={newAssign.subject_id} onChange={(e) => setNewAssign({ ...newAssign, subject_id: e.target.value })} required>
              <option value="">Select subject</option>
              {assignSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code ? `${s.name} (${s.code})` : s.name}
                </option>
              ))}
            </select>
            <button className="btn2 btn2-primary w-100" type="submit">Assign access</button>
          </form>
          <div className="mt-3 mono" style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>
            This is what keeps Teacher A from seeing Teacher B's students.
          </div>
        </div>
      </div>

      <div className="col-lg-4">
        <div className="card2">
          <span className="eyebrow">Current classes</span>
          <ul className="mt-2" style={{ paddingLeft: "1.1rem" }}>
            {classes.length === 0 && <li className="mono" style={{ color: "var(--ink-soft)" }}>No classes yet</li>}
            {classes.map((c) => (
              <li key={c.id}>
                {c.name}
                {c.section ? ` — Sec ${c.section}` : ""}{" "}
                <span className="mono" style={{ color: "var(--ink-soft)" }}>#{c.id}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card2 mt-4">
          <span className="eyebrow">Subjects</span>
          <ul className="mt-2" style={{ paddingLeft: "1.1rem" }}>
            {subjects.length === 0 && <li className="mono" style={{ color: "var(--ink-soft)" }}>No subjects yet</li>}
            {subjects.map((s) => (
              <li key={s.id}>
                {s.name} · {s.class_name}
                {s.section ? ` ${s.section}` : ""}
              </li>
            ))}
          </ul>
        </div>
        <div className="card2 mt-4">
          <span className="eyebrow">Assignments</span>
          <ul className="mt-2" style={{ paddingLeft: "1.1rem" }}>
            {assignments.length === 0 && <li className="mono" style={{ color: "var(--ink-soft)" }}>No assignments yet</li>}
            {assignments.map((a) => (
              <li key={a.id} className="mono" style={{ fontSize: "0.85rem" }}>
                {a.username} → {a.class_name}
                {a.section ? ` ${a.section}` : ""} / {a.subject_name}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function HealthTab({ health, onRefresh }) {
  return (
    <div className="card2">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <span className="eyebrow">System health</span>
          <h5 style={{ margin: 0 }}>Live status of the deployment</h5>
        </div>
        <button className="btn2 btn2-outline btn-sm" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {!health ? (
        <div className="mono mt-3" style={{ color: "var(--ink-soft)" }}>Loading…</div>
      ) : (
        <>
          <div className="row g-3 mt-1">
            <div className="col-lg-3 col-6">
              <StatCard
                label={health.database === "ok" ? "Database — OK" : "Database — UNREACHABLE"}
                value={health.status === "ok" ? "OK" : "DOWN"}
                hint={health.database}
              />
            </div>
            <div className="col-lg-3 col-6">
              <StatCard
                label="Trained model"
                value={health.model?.exists ? "Present" : "Missing"}
                hint={health.model?.size_mb != null ? `${health.model.size_mb} MB` : "no model.pkl"}
              />
            </div>
            <div className="col-lg-3 col-6">
              <StatCard
                label="Face dataset"
                value={health.dataset?.size_mb ?? 0}
                hint={`${health.dataset?.students ?? 0} students · ${health.dataset?.files ?? 0} photos`}
              />
            </div>
            <div className="col-lg-3 col-6">
              <StatCard
                label="Latest backup"
                value={health.backup?.latest ? "Found" : "None yet"}
                hint={health.backup?.latest || "nightly at 02:00"}
              />
            </div>
          </div>

          <div className="row g-4 mt-3">
            <div className="col-lg-6">
              <div className="panel-copy" style={{ marginBottom: "0.4rem" }}>
                <strong>Model training status</strong>
              </div>
              <pre className="mono" style={{ fontSize: "0.78rem", color: "var(--ink-soft)", margin: 0, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(health.train_status, null, 2)}
              </pre>
            </div>
            <div className="col-lg-6">
              <div className="panel-copy" style={{ marginBottom: "0.4rem" }}>
                <strong>Dataset location</strong>
              </div>
              <div className="mono" style={{ fontSize: "0.8rem" }}>{health.dataset?.dir || "—"}</div>
              <div className="panel-copy mt-3" style={{ marginBottom: 0 }}>
                Backups are created nightly by the <span className="mono">attendance-backup.timer</span> on the
                server — the health email probe hits <span className="mono">/api/health</span> every 5 minutes.
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
