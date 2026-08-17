import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import usePageTitle from "../components/usePageTitle";
import Brand from "../components/Brand";
import { api } from "../api";

function useCountUp(target, duration = 1600) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || target == null) return;
    started.current = true;
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function CountStat({ label, value, suffix }) {
  const n = useCountUp(value);
  return (
    <div className="landing-stat">
      <div className="landing-stat-num">{n.toLocaleString()}{suffix || ""}</div>
      <div className="landing-stat-label">{label}</div>
    </div>
  );
}

function FeatureIcon({ type }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };
  switch (type) {
    case "face":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <path d="M8.5 14.5c.9 1.1 2.2 1.6 3.5 1.6s2.6-.5 3.5-1.6" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="13" rx="3" />
          <circle cx="12" cy="13.5" r="3.5" />
          <path d="M9 7l1.5-2.5h3L15 7" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
          <path d="M9.5 12l1.8 1.8 3.2-3.6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      );
  }
}

const FEATURES = [
  { icon: "face", title: "Face recognition", text: "Mark attendance with a webcam in seconds — no roll-call, no proxies." },
  { icon: "camera", title: "Classroom photo", text: "Scan a photo of the whole room and mark everyone present at once." },
  { icon: "shield", title: "Secure by design", text: "Role-based access for students, teachers and admins, with a full audit trail." },
  { icon: "chart", title: "Insights & analytics", text: "Per-student and per-class analytics, plus Excel register export." },
];

export default function Landing() {
  usePageTitle("Digital Attendance");
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/landing_stats").then(setStats).catch(() => {});
  }, []);

  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <div className="landing-nav-actions">
          <Link to="/login" className="btn2 btn2-outline">
            Sign in
          </Link>
          <Link to="/register" className="btn2 btn2-primary">
            Student sign up
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-orb landing-orb-1" aria-hidden="true" />
        <div className="landing-orb landing-orb-2" aria-hidden="true" />
        <div className="landing-orb landing-orb-3" aria-hidden="true" />
        <div className="landing-hero-inner">
          <div className="landing-eyebrow">ITM University · Face-recognition attendance</div>
          <h1 className="landing-title">
            Attendance, marked <span>in seconds.</span>
          </h1>
          <p className="landing-sub">
            Replace roll-call with a glance. Students are recognised by face,
            records are saved automatically, and teachers keep full control.
          </p>
          <div className="landing-hero-actions">
            <Link to="/login" className="btn2 btn2-primary btn-lg">
              Login
            </Link>
            <Link to="/register" className="btn2 btn2-outline btn-lg">
              Student? Create an account
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-stats" aria-label="Live statistics">
        <CountStat label="Students enrolled" value={stats?.students ?? 0} />
        <CountStat label="Classes" value={stats?.classes ?? 0} />
        <CountStat label="Attendance today" value={stats?.attendance_today ?? 0} />
        <CountStat label="Face embeddings" value={stats?.embeddings ?? 0} />
      </section>

      <section className="landing-features">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="landing-feature" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="landing-feature-icon">
              <FeatureIcon type={f.icon} />
            </div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <section className="landing-cta">
        <h2>Ready to mark class?</h2>
        <p>Sign in as a teacher or admin to open your workspace.</p>
        <Link to="/login" className="btn2 btn2-primary btn-lg">
          Login to your workspace
        </Link>
      </section>

      <footer className="landing-footer">Digital Attendance · ITM University</footer>
    </div>
  );
}