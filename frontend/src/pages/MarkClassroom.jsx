import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, postFormData } from "../api";
import usePageTitle from "../components/usePageTitle";
import { captureBlob, resizeImageBlob, useCamera } from "../components/useCamera";
import ClassSubjectSelector from "../components/ClassSubjectSelector";

const STRONG_MATCH = 0.44;

function reviewInfo(face) {
  if (!face.recognized) return { label: "Unknown — skip", needsReview: true };
  if (face.already_marked) return { label: "Already marked", needsReview: false };
  const weak =
    face.needs_review === true ||
    (typeof face.needs_review === "undefined" && (face.confidence || 0) < STRONG_MATCH);
  return weak ? { label: "Needs review", needsReview: true } : { label: "Auto-OK", needsReview: false };
}

function faceBoxStyle(face) {
  if (!face.recognized) return { color: "#64748B", label: "Unknown" };
  const review = reviewInfo(face);
  if (face.already_marked) return { color: "#64748B", label: face.name || "Matched" };
  if (review.needsReview) return { color: "#D97706", label: face.name || "Matched" };
  return { color: "#0D9488", label: face.name || "Matched" };
}

function drawFaceBox(ctx, face) {
  const bbox = face.bbox;
  if (!bbox || bbox.length < 4) return;
  const [x1, y1, x2, y2] = bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < 2 || h < 2) return;
  const { color, label } = faceBoxStyle(face);
  const lineW = Math.max(2, Math.min(4, Math.round(Math.min(w, h) * 0.02)));
  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
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

async function compressImageForUpload(fileOrBlob, maxDimension = 1920, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(fileOrBlob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          resolve(blob || fileOrBlob);
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(fileOrBlob);
    };
    img.src = url;
  });
}

export default function MarkClassroom() {

  usePageTitle('Classroom Photo');
  const [session, setSession] = useState({ classId: "", subjectId: "" });
  const [blobs, setBlobs] = useState([]);
  const [status, setStatus] = useState("");
  const [faces, setFaces] = useState([]); // detected faces (merged)
  const [previewFaces, setPreviewFaces] = useState([]);
  const [checked, setChecked] = useState({}); // student_id -> bool
  const [summary, setSummary] = useState(null);
  const [confirmMsg, setConfirmMsg] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const handleSessionSelect = useCallback((s) => setSession(s), []);

  const { videoRef, attachVideo, live, start, stop, error, facingMode, flipCamera, hasMultipleCameras } = useCamera(
    () => {},
    { width: 1920, height: 1080, defaultFacing: "environment" }
  );

  useEffect(() => () => stop(), [stop]);

  function clearAll() {
    setBlobs([]);
    setFaces([]);
    setPreviewFaces([]);
    setChecked({});
    setSummary(null);
    setConfirmMsg("");
    setStatus("Cleared. Ready for a new batch.");
    stop();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onCapture() {
    const blob = await captureBlob(videoRef.current);
    setBlobs((prev) => [...prev, blob]);
    setStatus(`${blobs.length + 1} photo(s) ready. Capture more or click "Analyze Photo".`);
  }

  async function onFiles(e) {
    const files = Array.from(e.target.files || []);
    const resized = await Promise.all(files.map((f) => resizeImageBlob(f)));
    setBlobs((prev) => [...prev, ...resized]);
    setStatus(`${blobs.length + resized.length} photo(s) ready. Capture more or click "Analyze Photo".`);
  }

  async function analyze() {
    if (!session.classId || !session.subjectId) {
      alert("Select class and subject before analyzing.");
      return;
    }
    if (blobs.length === 0) {
      alert("Please choose photo(s) or capture with the camera first.");
      return;
    }
    setAnalyzing(true);
    setFaces([]);
    setPreviewFaces([]);
    setChecked({});
    setSummary(null);
    setConfirmMsg("");
    setStatus(`Analyzing ${blobs.length} photo(s)... this may take a moment.`);
    stop();

    const merged = new Map();
    const unknowns = [];
    let anyError = null;
    let firstFaces = [];

    for (let i = 0; i < blobs.length; i++) {
      const file = blobs[i];
      const optimizedBlob = await compressImageForUpload(file, 1920, 0.85);
      const fd = new FormData();
      fd.append("image", optimizedBlob, "photo.jpg");
      fd.append("class_id", session.classId);
      fd.append("subject_id", session.subjectId);
      try {
        const data = await postFormData("/recognize_classroom", fd);
        if (data.error) {
          anyError = data.error;
          continue;
        }
        const fs = data.faces || [];
        if (i === 0) firstFaces = fs;
        fs.forEach((face) => {
          if (face.recognized) {
            const existing = merged.get(face.student_id);
            if (!existing || face.confidence > existing.confidence) merged.set(face.student_id, face);
          } else {
            unknowns.push(face);
          }
        });
      } catch {
        anyError = "Network error while analyzing a photo.";
      }
    }

    const detected = [...merged.values(), ...unknowns];
    const initChecked = {};
    detected.forEach((f) => {
      if (f.recognized && !f.already_marked && !f.needs_review && (f.confidence || 0) >= STRONG_MATCH) {
        initChecked[f.student_id] = true;
      }
    });
    setFaces(detected);
    setPreviewFaces(firstFaces);
    setChecked(initChecked);
    setAnalyzing(false);

    if (detected.length === 0) {
      setStatus(anyError ? `Error: ${anyError}` : "No faces detected across the photo(s).");
      return;
    }
    setStatus(
      `Found ${detected.length} unique face(s) across ${blobs.length} photo(s).` +
        (anyError ? ` (one photo had an issue: ${anyError})` : "")
    );
    drawPreview(firstFaces);
  }

  function drawPreview(faces) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const firstFile = blobs[0];
    if (!firstFile) return;
    const url = URL.createObjectURL(firstFile);
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      faces.forEach((f) => drawFaceBox(ctx, f));
      const boxed = faces.filter((f) => f.bbox && f.bbox.length >= 4).length;
      ctx.fillStyle = "rgba(16,24,40,0.75)";
      ctx.fillRect(10, 10, 380, 30);
      ctx.fillStyle = "#fff";
      ctx.font = "14px sans-serif";
      ctx.fillText(`Preview (first photo) — ${boxed} face box(es)`, 18, 30);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  async function confirm() {
    const studentIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => parseInt(k));
    if (studentIds.length === 0) {
      setConfirmMsg("No students selected to save.");
      return;
    }
    if (!session.classId || !session.subjectId) {
      setConfirmMsg("Missing class/subject — analyze again.");
      return;
    }
    setConfirmMsg("Saving...");
    try {
      const data = await api.post("/confirm_classroom_attendance", {
        student_ids: studentIds,
        class_id: parseInt(session.classId),
        subject_id: parseInt(session.subjectId),
      });
      const unknownCount = faces.filter((f) => !f.recognized).length;
      const alreadyMarkedCount = faces.filter((f) => f.recognized && f.already_marked).length;
      setSummary({
        saved: data.saved,
        alreadyMarked: alreadyMarkedCount,
        unknown: unknownCount,
        total: faces.length,
      });
      setConfirmMsg("");
      setBlobs([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setConfirmMsg(err.message || "Error saving attendance.");
    }
  }

  const reviewCount = faces.filter(
    (f) => f.recognized && !f.already_marked && reviewInfo(f).needsReview
  ).length;

  return (
    <div className="page" style={{ maxWidth: "1120px" }}>
      <div className="page-kicker">
        <div>
          <span className="eyebrow">Batch recognition · Phase 2</span>
          <h1>Classroom Photo</h1>
          <p className="panel-copy mt-2">
            Tip: take 2–3 photos from the front. Students should face the camera. Side faces are
            harder than live Mark Attendance.
          </p>
        </div>
        <Link to="/" className="btn2 btn2-outline">
          Back to dashboard
        </Link>
      </div>

      <div className="step-rail">
        <div className="step-chip active">
          <span className="n">1</span> Class &amp; subject
        </div>
        <div className={`step-chip ${blobs.length ? "active" : ""}`}>
          <span className="n">2</span> Capture / upload
        </div>
        <div className={`step-chip ${faces.length ? "active" : ""}`}>
          <span className="n">3</span> Review &amp; save
        </div>
      </div>

      <div className="workspace-split">
        <div className="card2">
          <span className="eyebrow">Setup</span>
          <h2 className="panel-title">Session &amp; photos</h2>
          <p className="panel-copy">Best for 80+ seats — take a few angles, then analyze once.</p>

          <div className="session-bar">
            <ClassSubjectSelector onSelect={handleSessionSelect} />
          </div>

          <div className="d-flex gap-2 mb-3 flex-wrap">
            <button className="btn2 btn2-outline" onClick={() => start()} disabled={live}>
              Use Camera
            </button>
          </div>

          <label className="label2">Upload classroom photo(s)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="input2 mb-3"
            onChange={onFiles}
          />

          {live && (
            <div className="mb-3">
              <div className="scan-stage is-live" style={{ minHeight: "240px" }}>
                <video
                  ref={attachVideo}
                  autoPlay
                  muted
                  playsInline
                  style={{ minHeight: "240px", width: "100%", objectFit: "cover" }}
                />
                <div className="scan-corners">
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} />
                  ))}
                </div>
              </div>
              <div className="d-flex gap-2 mt-2 flex-wrap">
                <button className="btn2 btn2-teal" onClick={onCapture}>
                  📸 Capture Photo
                </button>
                <button
                  className="btn2 btn2-outline"
                  type="button"
                  onClick={flipCamera}
                  title="Switch between front and back cameras"
                >
                  🔄 Flip ({facingMode === "environment" ? "Back" : "Front"})
                </button>
                <button className="btn2 btn2-outline" onClick={stop}>
                  Close Camera
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="mono" style={{ color: "#b91c1c", marginBottom: "0.5rem" }}>
              Camera error: {error}
            </div>
          )}

          <div className="d-grid gap-2">
            <button className="btn2 btn2-primary" onClick={analyze} disabled={analyzing || blobs.length === 0}>
              {analyzing ? "Analyzing…" : "Analyze Photo"}
            </button>
            <button className="btn2 btn2-outline" onClick={clearAll}>
              Clear Photos
            </button>
          </div>
          <div className="mono mt-3" style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
            {status}
          </div>
        </div>

        <div className="card2">
          <span className="eyebrow">Results</span>
          <h2 className="panel-title">Preview &amp; review</h2>
          <p className="panel-copy">Check matches, then confirm who to mark present.</p>

          <div className="text-center">
            <canvas
              ref={canvasRef}
              style={{ maxWidth: "100%", borderRadius: "var(--radius)", border: "1px solid var(--line)", background: "#fff" }}
            />
          </div>

          {summary && (
            <div className="card2 mt-3" style={{ background: "#F7F7F5", borderColor: "var(--line)" }}>
              <span className="eyebrow">Result</span>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: 700, color: "var(--navy)" }}>
                    {summary.saved}
                  </div>
                  <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                    Marked present
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: 700, color: "var(--navy-dark)" }}>
                    {summary.alreadyMarked}
                  </div>
                  <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                    Already marked today
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: 700, color: "var(--amber)" }}>
                    {summary.unknown}
                  </div>
                  <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                    Unknown faces
                  </div>
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "1.6rem", fontWeight: 700 }}>{summary.total}</div>
                  <div className="mono" style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                    Total faces found
                  </div>
                </div>
              </div>
            </div>
          )}

          {faces.length > 0 && !summary && (
            <div className="mt-3">
              <span className="eyebrow">Review before saving</span>
              <h5 style={{ margin: "0.4rem 0 1rem" }}>
                Detected students
                {reviewCount > 0 && (
                  <span className="mono" style={{ color: "var(--amber)", fontWeight: 500, marginLeft: "0.6rem" }}>
                    {reviewCount} weaker match(es)
                  </span>
                )}
              </h5>
              <div className="table-responsive">
                <table className="table2">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Name</th>
                      <th>Confidence</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {faces.map((face, i) => {
                      const review = reviewInfo(face);
                      const isChecked = face.recognized ? Boolean(checked[face.student_id]) : false;
                      return (
                        <tr key={i} style={review.label === "Needs review" ? { background: "rgba(245,158,11,0.08)" } : undefined}>
                          <td>
                            {face.recognized && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) =>
                                  setChecked((prev) => ({ ...prev, [face.student_id]: e.target.checked }))
                                }
                              />
                            )}
                          </td>
                          <td>
                            {face.recognized ? `${face.name} (Roll: ${face.roll || "-"})` : "Unknown"}
                          </td>
                          <td className="mono">
                            {face.recognized ? `${Math.round((face.confidence || 0) * 100)}%` : "—"}
                          </td>
                          <td>
                            <span
                              className="mono"
                              style={{
                                fontWeight: review.label === "Needs review" ? 600 : undefined,
                                color:
                                  review.label === "Needs review"
                                    ? "var(--amber)"
                                    : review.label === "Auto-OK"
                                      ? "var(--navy)"
                                      : "var(--ink-soft)",
                              }}
                            >
                              {review.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button className="btn2 btn2-teal mt-2" onClick={confirm}>
                Confirm &amp; Save Attendance
              </button>
              <div className="mono mt-2" style={{ fontSize: "0.8rem", color: "var(--ink-soft)" }}>
                {confirmMsg}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
