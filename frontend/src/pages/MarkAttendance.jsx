import { useEffect, useRef, useState } from "react";
import { api, postFormData } from "../api";
import usePageTitle from "../components/usePageTitle";
import { captureBlob, useCamera } from "../components/useCamera";
import ClassSubjectSelector from "../components/ClassSubjectSelector";

// Map image-pixel bbox onto object-fit:cover video (mirrors Flask camera_mark.js)
function mapBboxCover(bbox, srcW, srcH, destW, destH) {
  const scale = Math.max(destW / srcW, destH / srcH);
  const drawnW = srcW * scale;
  const drawnH = srcH * scale;
  const offX = (destW - drawnW) / 2;
  const offY = (destH - drawnH) / 2;
  return [
    bbox[0] * scale + offX,
    bbox[1] * scale + offY,
    bbox[2] * scale + offX,
    bbox[3] * scale + offY,
  ];
}

export default function MarkAttendance() {

  usePageTitle('Mark Attendance');
  const [session, setSession] = useState({ classId: "", subjectId: "" });
  const [recognized, setRecognized] = useState([]);
  const [status, setStatus] = useState("Waiting...");
  const [running, setRunning] = useState(false);
  const overlayRef = useRef(null);
  const scanStageRef = useRef(null);

  const onFrame = async (video) => {
    if (!session.classId || !session.subjectId) return;
    const blob = await captureBlob(video);
    const fd = new FormData();
    fd.append("image", blob, "snap.jpg");
    fd.append("class_id", session.classId);
    fd.append("subject_id", session.subjectId);
    try {
      const j = await postFormData("/recognize_face", fd);
      drawBox(j);
      if (j.recognized) {
        const note = j.already_marked ? "already marked today" : "attendance saved";
        setStatus(`Matched: ${j.name} — ${note}`);
        if (j.student_id && !recognizedRef.current.has(j.student_id)) {
          recognizedRef.current.add(j.student_id);
          setRecognized((prev) => [
            { name: j.name, student_id: j.student_id, time: new Date().toLocaleTimeString() },
            ...prev,
          ]);
        }
      } else if (j.error) {
        setStatus(`Not recognized: ${j.error}`);
        if (j.error === "no face detected") clearBox();
      } else {
        setStatus("Not recognized — ask student to face the camera");
      }
    } catch {
      // ignore per-frame errors
    }
  };

  const { videoRef, live, start, stop, error } = useCamera(onFrame, { width: 640, height: 480 });
  const recognizedRef = useRef(new Set());

  useEffect(() => {
    recognizedRef.current.clear();
    setRecognized([]);
    clearBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.classId, session.subjectId]);

  function clearBox() {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawBox(result) {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const destW = video.clientWidth || canvas.clientWidth;
    const destH = video.clientHeight || canvas.clientHeight;
    if (!destW || !destH) return;
    if (canvas.width !== destW || canvas.height !== destH) {
      canvas.width = destW;
      canvas.height = destH;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, destW, destH);

    const bbox = result && result.bbox;
    if (!bbox || bbox.length < 4) return;
    const srcW = result.image_width || video.videoWidth || 640;
    const srcH = result.image_height || video.videoHeight || 480;
    const [x1, y1, x2, y2] = mapBboxCover(bbox, srcW, srcH, destW, destH);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 2 || h < 2) return;

    let color = "#94A3B8";
    let label = result.label || "Unknown";
    if (result.recognized) {
      color = result.already_marked ? "#64748B" : "#0D9488";
      label = result.name || label;
    } else if (result.error === "no face detected") {
      return;
    } else {
      label = "Unknown";
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x1, y1, w, h);

    ctx.font = "bold 14px sans-serif";
    const padX = 6;
    const boxH = 22;
    const textW = ctx.measureText(label).width;
    let labelY = y1 - boxH - 2;
    if (labelY < 0) labelY = y1 + 2;
    ctx.fillStyle = color;
    ctx.fillRect(x1, labelY, textW + padX * 2, boxH);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x1 + padX, labelY + boxH - 6);
  }

  async function startMark() {
    if (!session.classId || !session.subjectId) {
      alert("Select class and subject before starting.");
      return;
    }
    setRunning(true);
    await start(1200);
  }

  function stopMark() {
    stop();
    setRunning(false);
    setStatus("Stopped");
    clearBox();
  }

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Live recognition</span>
          <h1>Mark Attendance</h1>
        </div>
        <div className="d-flex gap-2">
          <button className="btn2 btn2-teal" onClick={startMark} disabled={running || !session.classId || !session.subjectId}>
            Start
          </button>
          <button className="btn2 btn2-danger" onClick={stopMark} disabled={!running}>
            Stop
          </button>
        </div>
      </div>

      <div className="step-rail">
        <div className={`step-chip ${session.classId ? "" : "active"}`}>
          <span className="n">1</span> Pick class &amp; subject
        </div>
        <div className={`step-chip ${live ? "active" : ""}`}>
          <span className="n">2</span> Start camera
        </div>
        <div className={`step-chip ${recognized.length ? "active" : ""}`}>
          <span className="n">3</span> Auto-save presents
        </div>
      </div>

      <div className="card2 mb-3">
        <span className="eyebrow">Session</span>
        <h2 className="panel-title">Where are you marking?</h2>
        <p className="panel-copy">One present mark per student · class · subject · day.</p>
        <div className="session-bar">
          <ClassSubjectSelector onSelect={(s) => setSession(s)} disabled={running} />
        </div>
      </div>

      <div className="workspace-split">
        <div className="card2">
          <span className="eyebrow">Camera stage</span>
          <h2 className="panel-title">Live scan</h2>
          <p className="panel-copy">Students walk up one by one. Recognition runs about every second.</p>
          <div className="scan-stage" ref={scanStageRef} style={{ position: "relative" }}>
            <video
              ref={videoRef}
              width="640"
              height="480"
              autoPlay
              muted
              playsInline
              style={{ minHeight: "340px", objectFit: "cover", width: "100%" }}
            />
            <canvas ref={overlayRef} className="scan-overlay" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
            <div className="scan-corners">
              {[1, 2, 3, 4].map((i) => (
                <span key={i} />
              ))}
            </div>
            {!live && (
              <div className="scan-stage-empty">
                <div>
                  <strong>Select class &amp; subject, then Start</strong>
                  <span>Live face recognition for entry desk</span>
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
            <div className="mono" style={{ fontSize: "0.85rem", color: "var(--ink-soft)" }}>
              {status}
            </div>
          </div>
        </div>

        <div className="card2">
          <span className="eyebrow">This session</span>
          <h2 className="panel-title">Recognized</h2>
          <p className="panel-copy">New matches appear here as they are saved.</p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.55rem" }}>
            {recognized.length === 0 && (
              <li className="mono" style={{ color: "var(--ink-soft)", fontSize: "0.85rem" }}>
                No matches yet.
              </li>
            )}
            {recognized.map((r, i) => (
              <li
                key={i}
                style={{
                  padding: "0.7rem 0.85rem",
                  border: "1px solid var(--line)",
                  borderRadius: "10px",
                  background: "rgba(255,255,255,0.75)",
                }}
              >
                <strong>{r.name}</strong>{" "}
                <span className="mono" style={{ color: "var(--ink-soft)", fontSize: "0.8rem" }}>
                  — {r.time}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
