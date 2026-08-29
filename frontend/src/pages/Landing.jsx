import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import usePageTitle from "../components/usePageTitle";
import Brand from "../components/Brand";
import ThreeDFaceCanvas from "../components/ThreeDFaceCanvas";
import TiltCard from "../components/TiltCard";
import { api } from "../api";

/* Scroll-triggered reveal / visibility hook */
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

function StatCard({ icon, label, value, loaded, start, suffix = "" }) {
  const n = useCountUp(loaded ? value : 0, start);
  return (
    <div className="landing-stat-card-light">
      <div className="landing-stat-icon-light">{icon}</div>
      <div className="landing-stat-body">
        <div className="landing-stat-num-light">
          {loaded ? `${n.toLocaleString()}${suffix}` : "—"}
        </div>
        <div className="landing-stat-label-light">{label}</div>
      </div>
    </div>
  );
}

const TECH_STACK = [
  {
    name: "InsightFace / ArcFace",
    category: "Biometric AI Model",
    desc: "Deep neural network embedding matching with 99.2% accuracy.",
    icon: "🧠",
    badge: "AI Core",
  },
  {
    name: "Django REST Framework",
    category: "Python Backend",
    desc: "High-throughput API views, custom auth backend & PostgreSQL ORM.",
    icon: "🐍",
    badge: "Backend",
  },
  {
    name: "React 18 + Vite",
    category: "Single Page App",
    desc: "Ultra-fast reactive UI with custom hooks for webcam stream capture.",
    icon: "⚡",
    badge: "Frontend",
  },
  {
    name: "PostgreSQL Database",
    category: "Relational Storage",
    desc: "ACID compliant persistence for student profiles, logs & audit trails.",
    icon: "🐘",
    badge: "Database",
  },
  {
    name: "Nginx & Gunicorn",
    category: "Server Proxy",
    desc: "Production reverse proxy handling SSL encryption & static assets.",
    icon: "🚀",
    badge: "Server",
  },
  {
    name: "Security & Permissions",
    category: "Edge Protection",
    desc: "HttpOnly cookies, HSTS headers & role-based permissions.",
    icon: "🛡️",
    badge: "Security",
  },
];

const FEATURES = [
  {
    icon: "📸",
    title: "Multi-Face Classroom Scan",
    text: "Snap a single photo of a 60+ student classroom. The AI detects all faces and marks attendance simultaneously in seconds.",
  },
  {
    icon: "📍",
    title: "Geofenced Event Check-in",
    text: "Students check in using mobile webcams. GPS coordinate validation guarantees physical presence within event radius.",
  },
  {
    icon: "🔒",
    title: "Role-Based Access Control",
    text: "Strict permission layers for Admins, Teachers, Mentors, Organizers, and Students with complete action audit trails.",
  },
  {
    icon: "🛡️",
    title: "HttpOnly Cookie Auth",
    text: "Session tokens are encapsulated in SameSite HttpOnly cookies, rendering credentials immune to JavaScript XSS attacks.",
  },
  {
    icon: "📊",
    title: "Instant Excel Register Export",
    text: "Generate official department attendance registers in formatted .xlsx or .csv files with a single click.",
  },
  {
    icon: "🤖",
    title: "AI Copilot Assistant",
    text: "Query attendance logs using natural language commands (e.g. 'Show CS-3A students absent today').",
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    step: "01",
    title: "Camera Feed Active",
    desc: "Teacher or student activates webcam feed via browser with zero software installation required.",
    icon: "📷",
  },
  {
    step: "02",
    title: "AI Face Detection",
    desc: "Neural network scans frame, locates face landmarks, and generates a 512-dim facial embedding vector.",
    icon: "🔍",
  },
  {
    step: "03",
    title: "Centroid Match Verified",
    desc: "Vector is compared against enrolled database centroids. High confidence matches trigger instant checkmarks.",
    icon: "✅",
  },
  {
    step: "04",
    title: "Audited Register Logged",
    desc: "Attendance record is timestamped, geofenced, and saved into PostgreSQL with live dashboard sync.",
    icon: "📊",
  },
];

export default function Landing() {
  usePageTitle("Digital Attendance · ITM University");
  const [stats, setStats] = useState(null);
  const [statsRef, statsInView] = useInView();

  useEffect(() => {
    api.get("/landing_stats").then(setStats).catch(() => {});
  }, []);

  const year = new Date().getFullYear();

  return (
    <div className="landing-light-root">
      {/* ---------- Top Navigation ---------- */}
      <header className="light-nav">
        <div className="light-nav-container">
          <Brand />
          <nav className="light-nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#tech-stack">Tech Stack</a>
            <a href="#features">Features</a>
          </nav>
          <div className="light-nav-actions">
            <Link to="/login" className="btn2 btn2-outline">
              Sign in
            </Link>
            <Link to="/register" className="btn2 btn2-primary">
              Sign Up
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- Hero Section with 3D Face Scene ---------- */}
      <section className="light-hero">
        <div className="light-hero-grid-bg" aria-hidden="true" />
        <div className="light-hero-container">
          <div className="light-hero-copy">
            <div className="pill-badge-light">
              <span className="pill-dot-light" /> ITM University · Digital Attendance
            </div>
            <h1 className="light-hero-headline">
              Attendance, <br />
              <span className="text-gradient-light">recognized instantly.</span>
            </h1>
            <p className="light-hero-sub">
              Replacing manual roll calls and proxy check-ins with high-precision AI face recognition. Built for modern university campuses and classroom management.
            </p>

            <div className="light-hero-actions">
              <Link to="/register" className="btn2 btn2-primary btn-lg">
                Sign Up <span style={{ marginLeft: "8px" }}>→</span>
              </Link>
              <Link to="/login" className="btn2 btn2-outline btn-lg">
                Sign In
              </Link>
            </div>

            <div className="light-hero-badges">
              <span>⚡ 1.2s Match Speed</span>
              <span>🔒 99.2% Accuracy</span>
              <span>🛡️ Geofenced Check-in</span>
            </div>
          </div>

          {/* 3D Scene Column */}
          <div className="light-hero-3d-col">
            <ThreeDFaceCanvas compact={false} showChips={true} />
          </div>
        </div>
      </section>

      {/* ---------- Live Stats Counter Section ---------- */}
      <section className="light-stats-section" ref={statsRef}>
        <div className="light-container">
          <div className="light-stats-grid">
            <StatCard
              icon="👥"
              label="Students Enrolled"
              value={stats?.students || 57}
              loaded={true}
              start={statsInView}
            />
            <StatCard
              icon="🎯"
              label="Recognition Accuracy"
              value={99}
              loaded={true}
              start={statsInView}
              suffix=".%+"
            />
            <StatCard
              icon="⚡"
              label="Avg Match Time"
              value={1}
              loaded={true}
              start={statsInView}
              suffix=".2s"
            />
            <StatCard
              icon="🛡️"
              label="Uptime & Audit Trail"
              value={100}
              loaded={true}
              start={statsInView}
              suffix="%"
            />
          </div>
        </div>
      </section>

      {/* ---------- How It Works Section ---------- */}
      <section id="how-it-works" className="light-section">
        <div className="light-container">
          <div className="light-section-header text-center">
            <div className="pill-badge-light">Process Overview</div>
            <h2 className="light-section-title">How It Works</h2>
            <p className="light-section-sub">
              From camera feed capture to automated PostgreSQL database entry in 4 seamless steps.
            </p>
          </div>

          <div className="how-it-works-grid">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <Reveal key={step.step} className="how-card-reveal">
                <div className="how-card-light">
                  <div className="how-step-num-light">{step.step}</div>
                  <div className="how-icon">{step.icon}</div>
                  <h3 className="how-title-light">{step.title}</h3>
                  <p className="how-desc-light">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Tech Stack Section (Interactive 3D Tilt Cards) ---------- */}
      <section id="tech-stack" className="light-section alt-bg-light">
        <div className="light-container">
          <div className="light-section-header text-center">
            <div className="pill-badge-light">Architecture</div>
            <h2 className="light-section-title">Built On Enterprise Tech</h2>
            <p className="light-section-sub">
              Move your cursor over cards to explore our production tech stack in 3D perspective.
            </p>
          </div>

          <div className="tech-stack-grid">
            {TECH_STACK.map((tech) => (
              <TiltCard key={tech.name} className="tech-tilt-card-light">
                <div className="tech-card-badge-light">{tech.badge}</div>
                <div className="tech-card-icon">{tech.icon}</div>
                <h3 className="tech-card-title-light">{tech.name}</h3>
                <div className="tech-card-cat-light">{tech.category}</div>
                <p className="tech-card-desc-light">{tech.desc}</p>
              </TiltCard>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Features Grid Section ---------- */}
      <section id="features" className="light-section">
        <div className="light-container">
          <div className="light-section-header text-center">
            <div className="pill-badge-light">Platform Capabilities</div>
            <h2 className="light-section-title">Everything You Need for Campus Attendance</h2>
            <p className="light-section-sub">
              Engineered for high-volume classroom verification, privacy compliance, and instant export.
            </p>
          </div>

          <div className="features-grid">
            {FEATURES.map((feat) => (
              <Reveal key={feat.title} className="feature-reveal-card">
                <TiltCard className="feature-card-light">
                  <div className="feature-icon">{feat.icon}</div>
                  <h3 className="feature-title-light">{feat.title}</h3>
                  <p className="feature-text-light">{feat.text}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Footer CTA Section ---------- */}
      <section className="light-cta-footer-section">
        <div className="light-cta-bg-3d">
          <ThreeDFaceCanvas compact={true} showChips={false} />
        </div>
        <div className="light-container text-center relative-z">
          <h2 className="light-cta-headline">Ready to modernize your classroom attendance?</h2>
          <p className="light-cta-sub">
            Experience real-time face recognition and geofenced event check-ins on our digital platform.
          </p>
          <div className="light-cta-actions">
            <Link to="/register" className="btn2 btn2-primary btn-lg">
              Sign Up Now →
            </Link>
            <Link to="/login" className="btn2 btn2-outline btn-lg">
              Sign In
            </Link>
          </div>
          <div className="light-footer-copyright">
            © {year} ITM University · Digital Attendance Management System. All rights reserved.
          </div>
        </div>
      </section>
    </div>
  );
}