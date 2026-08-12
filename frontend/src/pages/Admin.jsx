import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";

export default function Admin() {
  const toast = useToast();
  usePageTitle('Admin');
  const [overview, setOverview] = useState(null);
  const [assignSubjects, setAssignSubjects] = useState([]);

  const [newClass, setNewClass] = useState({ name: "", section: "", academic_year: "" });
  const [newSubject, setNewSubject] = useState({ class_id: "", name: "", code: "" });
  const [newTeacher, setNewTeacher] = useState({ full_name: "", username: "", password: "" });
  const [newAssign, setNewAssign] = useState({ user_id: "", class_id: "", subject_id: "" });

  const load = useCallback(async () => {
    try {
      setOverview(await api.get("/admin/overview"));
    } catch {}
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createClass(e) {
    e.preventDefault();
    try {
      await api.post("/classes", {
        name: newClass.name,
        section: newClass.section,
        academic_year: newClass.academic_year,
      });
      setNewClass({ name: "", section: "", academic_year: "" });
      load();
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
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function createTeacher(e) {
    e.preventDefault();
    try {
      await api.post("/teachers", newTeacher);
      setNewTeacher({ full_name: "", username: "", password: "" });
      load();
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
      load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  const classes = overview?.classes || [];
  const subjects = overview?.subjects || [];
  const teachers = overview?.teachers || [];
  const assignments = overview?.assignments || [];

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Classes, teachers &amp; access</h1>
        </div>
        <Link to="/" className="btn2 btn2-outline">
          Back to dashboard
        </Link>
      </div>

      <div className="step-rail">
        <div className="step-chip active">
          <span className="n">1</span> Create class
        </div>
        <div className="step-chip">
          <span className="n">2</span> Add subjects
        </div>
        <div className="step-chip">
          <span className="n">3</span> Assign teachers
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-4">
          <div className="card2">
            <span className="eyebrow">Create class</span>
            <form onSubmit={createClass} className="mt-2">
              <label className="label2">Name</label>
              <input
                className="input2 mb-2"
                value={newClass.name}
                onChange={(e) => setNewClass({ ...newClass, name: e.target.value })}
                placeholder="B.Tech CSE"
                required
              />
              <label className="label2">Section</label>
              <input
                className="input2 mb-2"
                value={newClass.section}
                onChange={(e) => setNewClass({ ...newClass, section: e.target.value })}
                placeholder="A"
              />
              <label className="label2">Academic year</label>
              <input
                className="input2 mb-3"
                value={newClass.academic_year}
                onChange={(e) => setNewClass({ ...newClass, academic_year: e.target.value })}
                placeholder="2025-26"
              />
              <button className="btn2 btn2-primary w-100" type="submit">
                Add class
              </button>
            </form>
          </div>

          <div className="card2 mt-4">
            <span className="eyebrow">Create subject</span>
            <form onSubmit={createSubject} className="mt-2">
              <label className="label2">Class</label>
              <select
                className="input2 mb-2"
                value={newSubject.class_id}
                onChange={(e) => setNewSubject({ ...newSubject, class_id: e.target.value })}
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
              <label className="label2">Subject name</label>
              <input
                className="input2 mb-2"
                value={newSubject.name}
                onChange={(e) => setNewSubject({ ...newSubject, name: e.target.value })}
                placeholder="Data Structures"
                required
              />
              <label className="label2">Code</label>
              <input
                className="input2 mb-3"
                value={newSubject.code}
                onChange={(e) => setNewSubject({ ...newSubject, code: e.target.value })}
                placeholder="DS101"
              />
              <button className="btn2 btn2-primary w-100" type="submit">
                Add subject
              </button>
            </form>
          </div>
        </div>

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
          </div>

          <div className="card2 mt-4">
            <span className="eyebrow">Assign teacher → class + subject</span>
            <form onSubmit={assignTeacher} className="mt-2">
              <label className="label2">Teacher</label>
              <select
                className="input2 mb-2"
                value={newAssign.user_id}
                onChange={(e) => setNewAssign({ ...newAssign, user_id: e.target.value })}
                required
              >
                <option value="">Select teacher</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.username}
                    {t.full_name ? ` (${t.full_name})` : ""}
                  </option>
                ))}
              </select>
              <label className="label2">Class</label>
              <select
                className="input2 mb-2"
                value={newAssign.class_id}
                onChange={onAssignClassChange}
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
              <label className="label2">Subject</label>
              <select
                className="input2 mb-3"
                value={newAssign.subject_id}
                onChange={(e) => setNewAssign({ ...newAssign, subject_id: e.target.value })}
                required
              >
                <option value="">Select subject</option>
                {assignSubjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code ? `${s.name} (${s.code})` : s.name}
                  </option>
                ))}
              </select>
              <button className="btn2 btn2-primary w-100" type="submit">
                Assign access
              </button>
            </form>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card2">
            <span className="eyebrow">Current classes</span>
            <ul className="mt-2" style={{ paddingLeft: "1.1rem" }}>
              {classes.length === 0 && (
                <li className="mono" style={{ color: "var(--ink-soft)" }}>
                  No classes yet
                </li>
              )}
              {classes.map((c) => (
                <li key={c.id}>
                  {c.name}
                  {c.section ? ` — Sec ${c.section}` : ""}{" "}
                  <span className="mono" style={{ color: "var(--ink-soft)" }}>
                    #{c.id}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card2 mt-4">
            <span className="eyebrow">Subjects</span>
            <ul className="mt-2" style={{ paddingLeft: "1.1rem" }}>
              {subjects.length === 0 && (
                <li className="mono" style={{ color: "var(--ink-soft)" }}>
                  No subjects yet
                </li>
              )}
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
              {assignments.length === 0 && (
                <li className="mono" style={{ color: "var(--ink-soft)" }}>
                  No assignments yet
                </li>
              )}
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
    </div>
  );
}
