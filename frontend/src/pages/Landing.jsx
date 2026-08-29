import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import usePageTitle from "../components/usePageTitle";
import Brand from "../components/Brand";
import ThreeDFaceCanvas from "../components/ThreeDFaceCanvas";
import { api } from "../api";

/* Scroll-triggered reveal / visibility hook. Falls back to visible when
   IntersectionObserver is unavailable (e.g. older browsers, tests).
   `once` keeps observing and flips both ways when false. */
function useInView(threshold = 0.15, once = true) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once]);
  return [ref, inView];
}

function Reveal({ children, className = "", style = {}, Tag = "div" }) {
  const [ref, inView] = useInView();
  const cls = `${className}${inView ? " is-in" : ""}`;
  return (
    <Tag ref={ref} className={cls} style={style}>
      {children}
    </Tag>
  );
}

function useCountUp(target, start) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !start) return;
    started.current = true;
    const duration = 1400;
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
  }, [target, start]);
  return value;
}

const iconAttrs = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Icon({ type }) {
  switch (type) {
    case "cap":
      return (
        <svg {...iconAttrs}>
          <path d="M2 9l10-5 10 5-10 5-10-5z" />
          <path d="M6 11.5v4c0 1.5 2.7 2.9 6 2.9s6-1.4 6-2.9v-4" />
          <path d="M22 9v5" />
        </svg>
      );
    case "school":
      return (
        <svg {...iconAttrs}>
          <rect x="4" y="11" width="16" height="9" rx="1" />
          <path d="M7 11V7h10v4" />
          <path d="M2 20h20" />
          <path d="M10 16h4" />
        </svg>
      );
      case "calendar":
        return (
          <svg {...iconAttrs}>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 10h18" />
            <path d="M9 15l2 2 4-4" />
          </svg>
        );
      case "book":
        return (
          <svg {...iconAttrs}>
            <path d="M4 5a2 2 0 012-2h11v16H6a2 2 0 00-2 2V5z" />
            <path d="M20 19V3h-3" />
            <path d="M6 20a2 2 0 002-2" />
          </svg>
        );
    case "face":
      return (
        <svg {...iconAttrs}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="9" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="10" r="1.2" fill="currentColor" stroke="none" />
          <path d="M8.5 14.5c.9 1.1 2.2 1.6 3.5 1.6s2.6-.5 3.5-1.6" />
        </svg>
      );
    case "camera":
      return (
        <svg {...iconAttrs}>
          <rect x="3" y="7" width="18" height="13" rx="3" />
          <circle cx="12" cy="13.5" r="3.5" />
          <path d="M9 7l1.5-2.5h3L15 7" />
        </svg>
      );
    case "chart":
      return (
        <svg {...iconAttrs}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M22 20H2" />
        </svg>
      );
    case "shield":
      return (
        <svg {...iconAttrs}>
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
          <path d="M9.5 12l1.8 1.8 3.2-3.6" />
        </svg>
      );
    default:
      return null;
  }
}

function StatCard({ icon, label, value, loaded, start }) {
  const n = useCountUp(loaded ? value : 0, start);
  return (
    <div className="landing-stat">
      <div className="landing-stat-icon">
        <Icon type={icon} />
      </div>
      <div>
        <div className="landing-stat-num">{loaded ? n.toLocaleString() : "—"}</div>
        <div className="landing-stat-label">{label}</div>
      </div>
    </div>
  );
}

const FEED_ROWS = [
  { id: "22BCS031", cls: "CS-3C", time: "09:41" },
  { id: "22BCS088", cls: "CS-3C", time: "09:41" },
  { id: "22BCS152", cls: "ME-2B", time: "09:40" },
];

// Stylised recognition viewfinder — decorative, marketing-only render.
// Animations pause while the panel is off-screen to save CPU/battery.
function CamPanel() {
  const [ref, inView] = useInView(0.1, false);
  return (
    <div ref={ref} className={`landing-cam${inView ? "" : " is-idle"}`} aria-hidden="true">
      <div className="landing-cam-panel">
        <div className="landing-cam-head">
          <span className="cam-live">
            <i /> Live
          </span>
          <span className="cam-title">Recognition feed</span>
          <span className="cam-fps">HQ camera</span>
        </div>
        <div className="landing-cam-stage">
          <svg className="landing-cam-face" viewBox="0 0 200 200" fill="none">
            <path className="wire wire-glow" d="M100 26c-38 0-64 30-64 70 0 42 28 78 64 78s64-36 64-78c0-40-26-70-64-70z" />
            <path className="wire wire-faint" d="M42 84c30-10 88-10 118 0" />
            <path className="wire wire-faint" d="M38 122c26-8 54-8 124 0" />
            <line className="wire wire-faint" x1="100" y1="26" x2="100" y2="174" />
            <g className="wire">
              <circle cx="74" cy="102" r="13" />
              <circle cx="126" cy="102" r="13" />
              <path d="M74 102h-8" />
              <path d="M126 102h8" />
            </g>
            <path className="wire" d="M100 98l-5 16 5 6 5-6-5-16z" />
            <path className="wire" d="M84 144q16 14 32 0" />
            <path className="wire wire-faint" d="M52 82l18-7" />
            <path className="wire wire-faint" d="M148 82l-18-7" />
            <circle className="wire wire-faint" cx="120" cy="140" r="2" />
            <circle className="wire wire-faint" cx="140" cy="124" r="2" />
          </svg>
          <div className="landing-cam-scan" />
          <span className="landing-cam-corner tl" />
          <span className="landing-cam-corner tr" />
          <span className="landing-cam-corner bl" />
          <span className="landing-cam-corner br" />
          <div className="cam-meta">
            <span className="cam-name">Student 22BCS031</span>
            <span className="cam-hit">Match · 0.98</span>
          </div>
        </div>
        <div className="landing-cam-feed">
          {FEED_ROWS.map((r, i) => (
            <div className="cam-row" key={r.id} style={{ animationDelay: `${900 + i * 140}ms` }}>
              <span className="cam-row-id">{r.id}</span>
              <span className="cam-row-cls">{r.cls}</span>
              <span className="cam-row-time">{r.time}</span>
              <span className="cam-row-ok">✓</span>
            </div>
          ))}
        </div>
      </div>
      <span className="landing-cam-chip landing-cam-chip-1">✓ Marked present</span>
      <span className="landing-cam-chip landing-cam-chip-2">≈ 1.2 s / student</span>
    </div>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Enrol your face",
    text: "Students register once with a few photos. The system builds a private face profile — no badges, no paper.",
  },
  {
    n: "02",
    title: "Get marked in a glance",
    text: "Walk into class and look at the webcam. Recognition runs in about a second and records appear instantly.",
  },
  {
    n: "03",
    title: "Analyse and export",
    text: "Faculty review day-to-day records, spot trends per student and subject, and export registers to Excel.",
  },
];

const FEATURES = [
  {
    icon: "face",
    title: "Face recognition",
    text: "Students are verified and marked in seconds — no roll-call, no proxy attendance, no manual lists.",
  },
  {
    icon: "camera",
    title: "Classroom capture",
    text: "Scan one photo of the room and every recognised student is marked present at once. Saves whole classes in one shot.",
  },
  {
    icon: "chart",
    title: "Analytics & reports",
    text: "Attendance trends per student, class and subject, with one-click Excel register export for the records office.",
  },
  {
    icon: "shield",
    title: "Secure & auditable",
    text: "Role-based access for students, faculty and admins, wrapped in a complete audit trail for every action.",
  },
];

export default function Landing() {
  usePageTitle("Digital Attendance");
  const [stats, setStats] = useState(null);
  const [heroMode, setHeroMode] = useState("3d");
  const [statsRef, statsInView] = useInView();

  useEffect(() => {
    api.get("/landing_stats").then(setStats).catch(() => {});
  }, []);

  const year = new Date().getFullYear();

  return (
    <div className="landing">
      <header className="landing-nav">
        <Brand />
        <nav className="landing-nav-menu" aria-label="Primary">
          <a href="#platform">Platform</a>
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="landing-nav-actions">
          <Link to="/login" className="btn2 btn2-primary">
            Sign in
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-bg" aria-hidden="true">
          <span className="landing-orb landing-orb-1" />
          <span className="landing-orb landing-orb-2" />
          <span className="landing-orb landing-orb-3" />
          <span className="landing-hero-grid" />
        </div>
        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">ITM University · Digital attendance</span>
            <h1 className="landing-title">
              Attendance, <span>marked in seconds.</span>
            </h1>
            <p className="landing-sub">
              Face-recognition attendance for ITM University. Scan a classroom once, mark
              everyone present in seconds, and let every record flow into audited, export-ready
              registers — no roll-call, no manual lists.
            </p>
            <div className="landing-hero-actions">
              <Link to="/login" className="btn2 btn2-primary btn-lg">
                Login
              </Link>
              <a href="#how-it-works" className="btn2 btn2-outline btn-lg">
                See how it works
              </a>
            </div>
            <div className="landing-hero-trust">
              <span>
                <i /> For faculty &amp; admins
              </span>
              <span>99.2% recognition accuracy*</span>
              <span>Runs on campus servers</span>
            </div>
          </div>
          <div className="landing-hero-visual-col" style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "540px" }}>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setHeroMode("3d")}
                className={`btn2 btn2-sm ${heroMode === "3d" ? "btn2-primary" : "btn2-outline"}`}
                style={{ padding: "4px 12px", fontSize: "12px", borderRadius: "20px" }}
              >
                ✨ 3D Biometric Scan
              </button>
              <button
                type="button"
                onClick={() => setHeroMode("live")}
                className={`btn2 btn2-sm ${heroMode === "live" ? "btn2-primary" : "btn2-outline"}`}
                style={{ padding: "4px 12px", fontSize: "12px", borderRadius: "20px" }}
              >
                📷 Live Feed Demo
              </button>
            </div>
            {heroMode === "3d" ? <ThreeDFaceCanvas /> : <CamPanel />}
          </div>
        </div>
      </section>

      <section className="landing-stats" aria-label="Live statistics" ref={statsRef}>
        <StatCard icon="cap" label="Students enrolled" value={stats?.students} loaded={stats != null} start={statsInView} />
        <StatCard icon="school" label="Active classes" value={stats?.classes} loaded={stats != null} start={statsInView} />
        <StatCard icon="calendar" label="Attendance today" value={stats?.attendance_today} loaded={stats != null} start={statsInView} />
        <StatCard icon="book" label="Subjects covered" value={stats?.subjects} loaded={stats != null} start={statsInView} />
      </section>

      <section id="how-it-works" className="landing-section" style={{ paddingTop: "5rem" }}>
        <Reveal className="landing-section-head">
          <span className="landing-section-eyebrow">How it works</span>
          <h2 className="landing-section-title">From roll-call to recognition</h2>
          <p className="landing-section-sub">
            Three steps replace the whole morning ritual of calling names and chasing sign-up sheets.
          </p>
        </Reveal>
        <Reveal className="landing-steps" Tag="div">
          {STEPS.map((s) => (
            <div className="landing-step" key={s.n}>
              <div className="landing-step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <section id="platform" className="landing-section">
        <Reveal className="landing-section-head" Tag="div">
          <span className="landing-section-eyebrow">Platform</span>
          <h2 className="landing-section-title">Built for daily campus life</h2>
          <p className="landing-section-sub">
            Everything a department needs — friendly for students, dependable for faculty, audited for the records office.
          </p>
        </Reveal>
        <Reveal className="landing-features" Tag="div">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-feature">
              <div className="landing-feature-icon">
                <Icon type={f.icon} />
              </div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <Reveal className="landing-cta" Tag="div">
        <h2>Ready to mark class?</h2>
        <p>Sign in as a teacher or admin to open your workspace and record today's lectures.</p>
        <Link to="/login" className="btn2 btn2-primary btn-lg">
          Login to your workspace
        </Link>
      </Reveal>

      <footer className="landing-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <Brand compact />
            <p>Face-recognition attendance for higher education — accurate, private and effortless.</p>
          </div>
          <div className="footer-links">
            <div className="footer-col">
              <h4>Get started</h4>
              <Link to="/login">Teacher sign in</Link>
              <Link to="/login">Admin sign in</Link>
            </div>
            <div className="footer-col">
              <h4>Platform</h4>
              <a href="#platform">Features</a>
              <a href="#how-it-works">How it works</a>
            </div>
            <div className="footer-col">
              <h4>Privacy</h4>
              <span>Enrolled faces stay on campus servers.</span>
              <span>Records carry a full audit trail.</span>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {year} ITM University · Digital Attendance</span>
          <span className="mono">*99.2% accuracy — measured against an internal department dataset</span>
        </div>
      </footer>
    </div>
  );
}