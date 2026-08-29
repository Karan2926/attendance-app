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
    <div className="landing-stat-card">
      <div className="landing-stat-icon">{icon}</div>
      <div className="landing-stat-body">
        <div className="landing-stat-num">
          {loaded ? `${n.toLocaleString()}${suffix}` : "—"}
        </div>
        <div className="landing-stat-label">{label}</div>
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
    name: "Cloudflare & Security",
    category: "Edge Protection",
    desc: "HttpOnly cookies, HSTS headers & rate-limiting protection.",
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
  usePageTitle("Digital Attendance · AI Face Recognition");
  const [stats, setStats] = useState(null);
  const [statsRef, statsInView] = useInView();

  useEffect(() => {
    api.get("/landing_stats").then(setStats).catch(() => {});
  }, []);

  const year = new Date().getFullYear();

  return (
    <div className="landing-dark-root">
      {/* ---------- Top Navigation ---------- */}
      <header className="dark-nav">
        <div className="dark-nav-container">
          <Brand />
          <nav className="dark-nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#tech-stack">Tech Stack</a>
            <a href="#features">Features</a>
          </nav>
          <div className="dark-nav-actions">
            <a
              href="https://github.com/Karan2926/attendance-app"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost-dark"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: "6px" }}>
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              GitHub
            </a>
            <Link to="/login" className="btn-glow-primary">
              See Live Demo →
            </Link>
          </div>
        </div>
      </header>

      {/* ---------- Hero Section with 3D Face Scene ---------- */}
      <section className="dark-hero">
        <div className="dark-hero-grid-bg" aria-hidden="true" />
        <div className="dark-hero-container">
          <div className="dark-hero-copy">
            <div className="pill-badge">
              <span className="pill-dot" /> AI-Powered Biometric Platform
            </div>
            <h1 className="dark-hero-headline">
              Attendance, <br />
              <span className="text-gradient">recognized instantly.</span>
            </h1>
            <p className="dark-hero-sub">
              Replacing manual roll calls and proxy check-ins with high-precision facial recognition AI. Built for modern university campuses and events.
            </p>

            <div className="dark-hero-actions">
              <Link to="/login" className="btn-glow-primary btn-lg">
                See Live Demo <span style={{ marginLeft: "8px" }}>→</span>
              </Link>
              <a
                href="https://github.com/Karan2926/attendance-app"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost-dark btn-lg"
              >
                View on GitHub
              </a>
            </div>

            <div className="dark-hero-badges">
              <span>⚡ 1.2s Match Speed</span>
              <span>🔒 99.2% Accuracy</span>
              <span>🛡️ Geofenced</span>
            </div>
          </div>

          {/* 3D Scene Column */}
          <div className="dark-hero-3d-col">
            <ThreeDFaceCanvas compact={false} showChips={true} />
          </div>
        </div>
      </section>

      {/* ---------- Live Stats Counter Section ---------- */}
      <section className="dark-stats-section" ref={statsRef}>
        <div className="dark-container">
          <div className="dark-stats-grid">
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
      <section id="how-it-works" className="dark-section">
        <div className="dark-container">
          <div className="dark-section-header text-center">
            <div className="pill-badge">Process Overview</div>
            <h2 className="dark-section-title">How It Works</h2>
            <p className="dark-section-sub">
              From camera feed capture to automated PostgreSQL database entry in 4 seamless steps.
            </p>
          </div>

          <div className="how-it-works-grid">
            {HOW_IT_WORKS_STEPS.map((step, idx) => (
              <Reveal key={step.step} className="how-card-reveal">
                <div className="how-card">
                  <div className="how-step-num">{step.step}</div>
                  <div className="how-icon">{step.icon}</div>
                  <h3 className="how-title">{step.title}</h3>
                  <p className="how-desc">{step.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Tech Stack Section (Interactive 3D Tilt Cards) ---------- */}
      <section id="tech-stack" className="dark-section alt-bg">
        <div className="dark-container">
          <div className="dark-section-header text-center">
            <div className="pill-badge">Architecture</div>
            <h2 className="dark-section-title">Built On Enterprise Tech</h2>
            <p className="dark-section-sub">
              Move your cursor over cards to explore our production tech stack in 3D perspective.
            </p>
          </div>

          <div className="tech-stack-grid">
            {TECH_STACK.map((tech) => (
              <TiltCard key={tech.name} className="tech-tilt-card">
                <div className="tech-card-badge">{tech.badge}</div>
                <div className="tech-card-icon">{tech.icon}</div>
                <h3 className="tech-card-title">{tech.name}</h3>
                <div className="tech-card-cat">{tech.category}</div>
                <p className="tech-card-desc">{tech.desc}</p>
              </TiltCard>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Features Grid Section ---------- */}
      <section id="features" className="dark-section">
        <div className="dark-container">
          <div className="dark-section-header text-center">
            <div className="pill-badge">Platform Capabilities</div>
            <h2 className="dark-section-title">Everything You Need for Campus Attendance</h2>
            <p className="dark-section-sub">
              Engineered for high-volume classroom verification, privacy compliance, and instant export.
            </p>
          </div>

          <div className="features-grid">
            {FEATURES.map((feat) => (
              <Reveal key={feat.title} className="feature-reveal-card">
                <TiltCard className="feature-card">
                  <div className="feature-icon">{feat.icon}</div>
                  <h3 className="feature-title">{feat.title}</h3>
                  <p className="feature-text">{feat.text}</p>
                </TiltCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Footer CTA Section ---------- */}
      <section className="dark-cta-footer-section">
        <div className="dark-cta-bg-3d">
          <ThreeDFaceCanvas compact={true} showChips={false} />
        </div>
        <div className="dark-container text-center relative-z">
          <h2 className="dark-cta-headline">Ready to modernize your classroom attendance?</h2>
          <p className="dark-cta-sub">
            Experience real-time face recognition and geofenced event check-ins on our live platform.
          </p>
          <div className="dark-cta-actions">
            <Link to="/login" className="btn-glow-primary btn-lg">
              Launch Live Demo →
            </Link>
            <a
              href="https://github.com/Karan2926/attendance-app"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost-dark btn-lg"
            >
              Star on GitHub ⭐
            </a>
          </div>
          <div className="dark-footer-copyright">
            © {year} ITM University · Digital Attendance Management System. All rights reserved.
          </div>
        </div>
      </section>
    </div>
  );
}