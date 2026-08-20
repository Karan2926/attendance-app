import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, postFormData } from "../api";
import usePageTitle from "../components/usePageTitle";
import { captureBlob, useCamera } from "../components/useCamera";

const PHASES = [
  ["Face the camera", 4],
  ["Slowly turn your head side to side", 8],
];
const QUICK_CAPTURES = PHASES.reduce((sum, p) => sum + p[1], 0);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default function AddStudent() {

  usePageTitle('Add Student');
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [name, setName] = useState("");
  const [roll, setRoll] = useState("");
  const [regNo, setRegNo] = useState("");
  const [classId, setClassId] = useState("");

  const [studentId, setStudentId] = useState(null);
  const [images, setImages] = useState([]);
  const [status, setStatus] = useState("");
  const [pose, setPose] = useState("");
  const [captured, setCaptured] = useState(0);
  const [cornerColor, setCornerColor] = useState("#2dd4bf");
  const [busy, setBusy] = useState(false);

  const [startCapture, setStartCapture] = useState(false);
  const { videoRef, live, start, stop, error } = useCamera(() => {}, { width: 640, height: 480 });

  useEffect(() => {
    api
      .get("/classes")
      .then((d) => setClasses(d.classes || []))
      .catch(() => {});
  }, []);

  useEffect(() => () => stop(), [stop]);

  async function saveInfo(e) {
    e.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const data = await api.post("/students", {
        name: name.trim(),
        roll: roll.trim(),
        reg_no: regNo.trim(),
        class_id: classId,
      });
      setStudentId(data.student_id);
      setStatus("Student info saved. Click Start Capture to open the camera.");
    } catch (err) {
      setStatus(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkQuality(blob) {
    const fd = new FormData();
    fd.append("image", blob, "check.jpg");
    try {
      const res = await postFormData("/check_face", fd);
      return res;
    } catch {
      return { ok: false, reason: "network error" };
    }
  }

  async function runQuickCapture() {
    setStartCapture(true);
    const collected = [];
    for (const [msg, count] of PHASES) {
      setPose(msg);
      await delay(900);
      let forPhase = 0;
      let attempts = 0;
      while (forPhase < count && attempts < count * 4) {
        attempts++;
        const blob = await captureBlob(videoRef.current);
        const q = await checkQuality(blob);
        if (q.ok) {
          collected.push(blob);
          forPhase++;
          setCornerColor("#0EA5A4");
          setCaptured(collected.length);
          setStatus(`Captured ${collected.length} / ${QUICK_CAPTURES}`);
        } else {
          setCornerColor("#EF4444");
          setStatus(
            `${q.reason || "Keep your face in the frame"}… (${collected.length} / ${QUICK_CAPTURES})`
          );
        }
        await delay(300);
      }
    }
    setPose("Done!");
    setCornerColor("#0EA5A4");

    const form = new FormData();
    form.append("student_id", studentId);
    collected.forEach((b, i) => form.append("images[]", b, `img_${i}.jpg`));
    try {
      await postFormData(`/students/${studentId}/upload_face`, form);
      setStatus(
        `Captured and uploaded ${collected.length} quality photos (front and side angles).`
      );
      stop();
      setStartCapture(false);
    } catch {
      setStatus("Upload failed");
    }
  }

  async function startCaptureFlow() {
    if (!studentId) {
      alert("Save student info first.");
      return;
    }
    try {
      await start();
      runQuickCapture();
    } catch {
      alert("Camera access error");
    }
  }

  const canCapture = Boolean(studentId && !live);

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Registration</span>
          <h1>Add Student</h1>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Link to="/manage_students" className="btn2 btn2-outline">
            Manage / Edit Students
          </Link>
          <Link to="/" className="btn2 btn2-outline">
            Back to dashboard
          </Link>
        </div>
      </div>

      <div className="step-rail">
        <div className={`step-chip ${studentId ? "" : "active"}`}>
          <span className="n">1</span> Save details
        </div>
        <div className={`step-chip ${studentId && !images ? "active" : ""}`}>
          <span className="n">2</span> Capture faces
        </div>
        <div className={`step-chip ${captured >= QUICK_CAPTURES ? "active" : ""}`}>
          <span className="n">3</span> Finish
        </div>
      </div>

      <div className="workspace-split">
        <div className="card2">
          <span className="eyebrow">Student details</span>
          <h2 className="panel-title">Who are we enrolling?</h2>
          <p className="panel-copy">
            Save info first, then capture a few quality photos so recognition stays accurate in
            large classes.
          </p>

          <form onSubmit={saveInfo}>
            <div className="row g-3">
              <div className="col-12">
                <label className="label2">Full name</label>
                <input
                  className="input2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Karan Bhadouriya"
                  required
                />
              </div>
              <div className="col-md-6">
                <label className="label2">Roll no.</label>
                <input
                  className="input2"
                  value={roll}
                  onChange={(e) => setRoll(e.target.value)}
                  placeholder="23"
                />
              </div>
              <div className="col-md-6">
                <label className="label2">Registration no.</label>
                <input
                  className="input2"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="REG-0001"
                />
              </div>
              <div className="col-12">
                <label className="label2">Enroll in class</label>
                <select
                  className="input2"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
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
              </div>
            </div>

            <div className="mt-4 d-grid gap-2">
              <button type="submit" className="btn2 btn2-primary" disabled={busy || Boolean(studentId)}>
                Save Info
              </button>
              <button
                type="button"
                className="btn2 btn2-teal"
                onClick={startCaptureFlow}
                disabled={!canCapture || startCapture}
              >
                {startCapture ? "Capturing…" : `Start Capture (${QUICK_CAPTURES})`}
              </button>
              <button
                type="button"
                className="btn2 btn2-outline"
                onClick={() => navigate("/")}
                disabled={captured === 0}
              >
                Finish &amp; return
              </button>
            </div>
          </form>
          {status && (
            <div className="mono mt-3" style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
              {status}
            </div>
          )}
        </div>

        <div className="card2">
          <span className="eyebrow">Face capture</span>
          <h2 className="panel-title">Camera stage</h2>
          <p className="panel-copy">
            Two short steps — face the camera, then slowly turn your head side to side.
            Good frames are captured and quality-checked automatically, keeping extra pose
            variety for accuracy without the long routine.
          </p>

          <div className="scan-stage" style={{ position: "relative" }}>
            <video
              ref={videoRef}
              width="640"
              height="480"
              autoPlay
              muted
              playsInline
              style={{ minHeight: "340px", objectFit: "cover", width: "100%" }}
            />
            <div className="scan-corners">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} style={{ borderColor: cornerColor }} />
              ))}
            </div>
            {!live && (
              <div className="scan-stage-empty">
                <div>
                  <strong>Camera ready when you are</strong>
                  <span>Save student info → Start Capture</span>
                </div>
              </div>
            )}
            {error && (
              <div className="scan-stage-empty">
                <div>
                  <strong>Camera error</strong>
                  <span>{error}</span>
                </div>
              </div>
            )}
          </div>

          <div className="capture-meter">
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, minHeight: "1.4em" }}>
              {pose || "Waiting for capture…"}
            </div>
            <div className="mono mt-1" style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
              Captured {captured} / {QUICK_CAPTURES}
            </div>
            <div className="progress2 mt-2">
              <div className="progress2-bar" style={{ width: `${(captured / QUICK_CAPTURES) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
