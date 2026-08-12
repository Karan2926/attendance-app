import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, postFormData } from "../api";
import { useAuth } from "../auth";
import { useToast } from "../components/Toast";
import usePageTitle from "../components/usePageTitle";
import EmptyState from "../components/EmptyState";

function Chart({ data }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const dates = data.dates || [];
    const counts = data.counts || [];
    const max = Math.max(1, ...counts);
    const padL = 30;
    const padB = 22;
    const padT = 10;
    const plotW = w - padL - 8;
    const plotH = h - padT - padB;

    // grid lines
    ctx.strokeStyle = "rgba(12,26,23,0.12)";
    ctx.fillStyle = "#3d524c";
    ctx.font = "10px monospace";
    for (let g = 0; g <= 4; g++) {
      const y = padT + plotH - (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - 8, y);
      ctx.stroke();
      ctx.fillText(String(Math.round((max * g) / 4)), 4, y + 3);
    }

    if (dates.length === 0) return;
    const step = plotW / Math.max(1, dates.length - 1);
    const pts = counts.map((c, i) => ({
      x: padL + i * step,
      y: padT + plotH - (c / max) * plotH,
    }));

    // area + line
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = "#0f7660";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.lineTo(pts[pts.length - 1].x, padT + plotH);
    ctx.lineTo(pts[0].x, padT + plotH);
    ctx.closePath();
    ctx.fillStyle = "rgba(15,118,96,0.12)";
    ctx.fill();

    // labels
    ctx.fillStyle = "#3d524c";
    ctx.font = "9px monospace";
    dates.forEach((d, i) => {
      if (i % 5 === 0 || i === dates.length - 1) {
        ctx.fillText(d, padL + i * step - 12, h - 6);
      }
    });
  }, [data]);
  return <canvas ref={canvasRef} style={{ width: "100%", height: "300px" }} />;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [dash, setDash] = useState(null);
  const [stats, setStats] = useState(null);
  const [trainStatus, setTrainStatus] = useState(null);
  const [storage, setStorage] = useState(null);
  const [polling, setPolling] = useState(null);
  const toast = useToast();
  usePageTitle("Dashboard");
  const role = user?.role;
  if (role === "student") return <Navigate to="/my_attendance" replace />;

  useEffect(() => {
    api.get("/dashboard").then(setDash).catch(() => {});
    api.get("/attendance_stats").then(setStats).catch(() => {});
    api
      .get("/storage_stats")
      .then(setStorage)
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get("/train_status")
      .then((s) => setTrainStatus(s))
      .catch(() => {});
  }, []);

  // Poll training progress while running
  useEffect(() => {
    if (!trainStatus) return;
    if (trainStatus.running) {
      const id = setInterval(async () => {
        try {
          const s = await api.get("/train_status");
          setTrainStatus(s);
          if (!s.running) {
            setPolling(null);
            clearInterval(id);
            api
              .get("/storage_stats")
              .then(setStorage)
              .catch(() => {});
          }
        } catch {
          clearInterval(id);
          setPolling(null);
        }
      }, 1500);
      setPolling(id);
      return () => clearInterval(id);
    }
    return undefined;
  }, [trainStatus?.running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startTraining() {
    try {
      const res = await postFormData("/train_model", new FormData());
      if (res.status === "already_running") return;
      setTrainStatus({ running: true, progress: 0, message: "Starting training" });
    } catch (err) {
      toast.error(err.message || "Training could not be started");
    }
  }

  return (
    <div className="page">
      <div className="dash-hero">
        <div className="dash-hero-main">
          <span className="eyebrow">{role} workspace</span>
          <h1>Digital Attendance</h1>
          <p>
            {user?.username
              ? `Welcome back, ${user.username}. `
              : "Welcome back. "}
            Mark presence with face recognition, then review class records.
          </p>
        </div>
        <div className="dash-stat">
          <span className="eyebrow">Your scope</span>
          <div className="num">{dash?.class_count ?? "—"}</div>
          <div className="mono" style={{ color: "var(--ink-soft)", marginTop: "0.4rem", fontSize: "0.78rem" }}>
            class{dash?.class_count === 1 ? "" : "es"}
            {dash?.assignment_count != null && (
              <> · {dash.assignment_count} assignment{dash.assignment_count === 1 ? "" : "s"}</>
            )}
          </div>
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-4">
          <div className="card2">
            <span className="eyebrow">Quick actions</span>
            <h5 style={{ margin: "0 0 1rem" }}>Run today’s flow</h5>
            <div className="d-grid gap-2">
              <Link className="btn2 btn2-primary" to="/add_student">
                Add Student
              </Link>
              <Link className="btn2 btn2-outline" to="/manage_students">
                Manage / Edit Students
              </Link>
              <Link className="btn2 btn2-teal" to="/mark_attendance">
                Mark Attendance
              </Link>
              <Link className="btn2 btn2-outline" to="/mark_attendance_classroom">
                Classroom Photo
              </Link>
              <Link className="btn2 btn2-outline" to="/attendance_record">
                View Records
              </Link>
              <Link className="btn2 btn2-outline" to="/register_export">
                Register Excel
              </Link>
              <Link className="btn2 btn2-teal" to="/copilot">
                AI Attendance Copilot
              </Link>
              {role === "admin" && (
                <Link className="btn2 btn2-outline" to="/admin">
                  Manage classes &amp; teachers
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-8">
          <div className="card2">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div>
                <span className="eyebrow">Recognition model</span>
                <h5 style={{ margin: 0 }}>Train Model</h5>
              </div>
              <button className="btn2 btn2-primary" onClick={startTraining} disabled={trainStatus?.running}>
                Start Training
              </button>
            </div>
            <div className="mt-3">
              <div className="progress2">
                <div className="progress2-bar" style={{ width: `${trainStatus?.progress || 0}%` }} />
              </div>
              <div className="mt-2 mono" style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
                {trainStatus?.message || "Add students with face photos, then train."}
              </div>
              {storage && (
                <div className="mt-2 mono" style={{ color: "var(--ink-soft)", fontSize: "0.78rem" }}>
                  Dataset: {storage.dataset.mb} MB · {storage.dataset.students} students ·{" "}
                  {storage.face_embeddings} embeddings
                </div>
              )}
            </div>
          </div>

          <div className="card2 mt-4">
            <span className="eyebrow">Last 30 days · your classes</span>
            <h5 style={{ margin: "0 0 1rem" }}>Attendance</h5>
            <div style={{ position: "relative", height: "300px", width: "100%" }}>
              {stats && stats.dates && stats.dates.length > 0 ? (
                <Chart data={stats} />
              ) : (
                <EmptyState
                  title="No attendance yet"
                  hint="Mark attendance once and your 30-day trend will appear here."
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
