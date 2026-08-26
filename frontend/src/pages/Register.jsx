import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, postFormData } from "../api";
import usePageTitle from "../components/usePageTitle";
import Brand from "../components/Brand";
import { captureBlob, useCamera } from "../components/useCamera";

const PHASES = [
  ["Face directly at the camera", 4],
  ["Slowly turn head slightly left", 4],
  ["Slowly turn head slightly right", 4],
];
const REQUIRED_CAPTURES = PHASES.reduce((sum, p) => sum + p[1], 0);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Register() {
  usePageTitle("Student Registration");
  const navigate = useNavigate();

  // Step 1: Form state
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [roll, setRoll] = useState("");
  const [regNo, setRegNo] = useState("");
  const [classId, setClassId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [classes, setClasses] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Step 2: Camera & Quality state
  const [capturedBlobs, setCapturedBlobs] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [poseInstruction, setPoseInstruction] = useState("Position your face in the center");
  const [feedback, setFeedback] = useState("Ensure you are in a well-lit room");
  const [cornerColor, setCornerColor] = useState("#0EA5A4");

  const { attachVideo, videoRef, live, start, stop, error: cameraError, facingMode, flipCamera } = useCamera(
    () => {},
    { width: 1280, height: 720, defaultFacing: "user" }
  );

  // Load public classes for dropdown
  useEffect(() => {
    api
      .get("/public_classes")
      .then((d) => setClasses(d.classes || []))
      .catch(() => {});
  }, []);

  useEffect(() => () => stop(), [stop]);

  function validateStep1(e) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !roll.trim() || !classId || !username.trim() || !password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    setStep(2);
    start();
  }

  async function checkQuality(blob) {
    const fd = new FormData();
    fd.append("image", blob, "check.jpg");
    try {
      const res = await postFormData("/check_face", fd);
      return res;
    } catch {
      return { ok: false, reason: "Network issue during quality check" };
    }
  }

  async function startGuidedScan() {
    setScanning(true);
    setCapturedBlobs([]);
    setError("");
    const collected = [];

    for (const [instruction, count] of PHASES) {
      setPoseInstruction(instruction);
      setCornerColor("#0EA5A4");
      await delay(1000);

      let phaseCount = 0;
      let attempts = 0;

      while (phaseCount < count && attempts < count * 6) {
        attempts++;
        if (!videoRef.current) break;

        const blob = await captureBlob(videoRef.current);
        const q = await checkQuality(blob);

        if (q.ok) {
          collected.push(blob);
          phaseCount++;
          setCapturedBlobs([...collected]);
          setCornerColor("#10B981");
          setFeedback(`Good lighting & clear angle! (${collected.length}/${REQUIRED_CAPTURES})`);
        } else {
          setCornerColor("#EF4444");
          setFeedback(q.reason || "Adjust your position or lighting");
        }
        await delay(350);
      }
    }

    setScanning(false);
    if (collected.length >= REQUIRED_CAPTURES) {
      setPoseInstruction("Face Verification Complete! Ready to submit.");
      setCornerColor("#10B981");
      setFeedback("All 12 high-quality photos verified successfully.");
    } else {
      setPoseInstruction("Incomplete — please retake in better lighting.");
      setCornerColor("#EF4444");
      setFeedback(`Captured ${collected.length}/${REQUIRED_CAPTURES} valid photos. Please try again.`);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (capturedBlobs.length < REQUIRED_CAPTURES) {
      setError("Please complete the face verification before creating your account.");
      return;
    }

    setBusy(true);
    setError("");

    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("roll", roll.trim());
    fd.append("reg_no", regNo.trim());
    fd.append("class_id", classId);
    fd.append("username", username.trim());
    fd.append("password", password);
    if (inviteCode) fd.append("invite_code", inviteCode.trim());

    capturedBlobs.forEach((b, i) => {
      fd.append("images[]", b, `face_${i}.jpg`);
    });

    try {
      await postFormData("/auth/register", fd);
      stop();
      navigate("/my_attendance");
    } catch (err) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel" style={{ maxWidth: step === 2 ? "680px" : "480px", transition: "all 0.3s ease" }}>
        <div className="mb-3">
          <Brand />
        </div>
        <h1 className="auth-brand">Student Registration</h1>
        <p className="auth-sub">
          {step === 1 ? "Step 1 of 2 · Enter your academic & login details" : "Step 2 of 2 · Face Verification & Quality Scan"}
        </p>

        {error && <div className="error-text mono mb-3">{error}</div>}

        {step === 1 && (
          <form onSubmit={validateStep1}>
            <label className="label2">Full Name *</label>
            <input
              className="input2 mb-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Karan Bhadouriya"
            />

            <div className="d-flex gap-2">
              <div style={{ flex: 1 }}>
                <label className="label2">Roll Number *</label>
                <input
                  className="input2 mb-3"
                  value={roll}
                  onChange={(e) => setRoll(e.target.value)}
                  required
                  placeholder="e.g. 0901CS221045"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label2">Registration No. (Optional)</label>
                <input
                  className="input2 mb-3"
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="e.g. ITM2022/45"
                />
              </div>
            </div>

            <label className="label2">Class &amp; Section *</label>
            <select
              className="input2 mb-3"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              required
            >
              <option value="">Select your class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || `${c.name} — Sec ${c.section}`}
                </option>
              ))}
            </select>

            <div className="d-flex gap-2">
              <div style={{ flex: 1 }}>
                <label className="label2">Choose Username *</label>
                <input
                  className="input2 mb-3"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  placeholder="e.g. karan29"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="label2">Choose Password *</label>
                <input
                  className="input2 mb-3"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength="8"
                  placeholder="Min. 8 characters"
                />
              </div>
            </div>

            <label className="label2">Registration Code (Optional)</label>
            <input
              className="input2 mb-3"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Leave blank if not required"
            />

            <button type="submit" className="btn2 btn2-primary w-100 mt-2">
              Continue to Face Verification ➔
            </button>
          </form>
        )}

        {step === 2 && (
          <div>
            <div className="card2 mb-3" style={{ background: "#F8FAFC", border: "1px solid var(--line)" }}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <span className="eyebrow" style={{ color: "var(--teal)" }}>
                  {poseInstruction}
                </span>
                <span className="mono" style={{ fontSize: "0.85rem", fontWeight: 700 }}>
                  {capturedBlobs.length} / {REQUIRED_CAPTURES} Verified
                </span>
              </div>

              <div
                className="scan-stage is-live"
                style={{
                  minHeight: "300px",
                  borderRadius: "12px",
                  overflow: "hidden",
                  position: "relative",
                  background: "#000",
                }}
              >
                <video
                  ref={attachVideo}
                  autoPlay
                  muted
                  playsInline
                  style={{ minHeight: "300px", width: "100%", objectFit: "cover" }}
                />
                <div className="scan-corners" style={{ borderColor: cornerColor }}>
                  {[1, 2, 3, 4].map((i) => (
                    <span key={i} style={{ borderColor: cornerColor }} />
                  ))}
                </div>
              </div>

              <div
                className="mono mt-2 p-2"
                style={{
                  fontSize: "0.85rem",
                  borderRadius: "6px",
                  textAlign: "center",
                  background: cornerColor === "#10B981" ? "#ECFDF5" : cornerColor === "#EF4444" ? "#FEF2F2" : "#F1F5F9",
                  color: cornerColor === "#10B981" ? "#065F46" : cornerColor === "#EF4444" ? "#991B1B" : "#334155",
                  fontWeight: 600,
                }}
              >
                {feedback}
              </div>

              <div className="d-flex gap-2 mt-3 flex-wrap">
                <button
                  type="button"
                  className="btn2 btn2-teal"
                  onClick={startGuidedScan}
                  disabled={scanning || !live}
                  style={{ flex: 1 }}
                >
                  {scanning ? "Scanning Angles…" : "📸 Start Face Scan"}
                </button>
                <button
                  type="button"
                  className="btn2 btn2-outline"
                  onClick={flipCamera}
                  disabled={scanning}
                >
                  🔄 Flip ({facingMode === "environment" ? "Back" : "Front"})
                </button>
              </div>
            </div>

            {cameraError && (
              <div className="mono mb-3" style={{ color: "#b91c1c", fontSize: "0.85rem" }}>
                Camera Error: {cameraError}
              </div>
            )}

            <div className="d-flex gap-2 mt-3">
              <button
                type="button"
                className="btn2 btn2-outline"
                onClick={() => {
                  stop();
                  setStep(1);
                }}
                disabled={busy || scanning}
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn2 btn2-primary"
                onClick={handleSubmit}
                disabled={busy || scanning || capturedBlobs.length < REQUIRED_CAPTURES}
                style={{ flex: 1 }}
              >
                {busy
                  ? "Creating Account…"
                  : capturedBlobs.length < REQUIRED_CAPTURES
                  ? `Locked (${capturedBlobs.length}/${REQUIRED_CAPTURES} captured)`
                  : "✓ Complete Registration"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 text-center">
          <Link to="/login" className="auth-link">
            Already have an account? Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
