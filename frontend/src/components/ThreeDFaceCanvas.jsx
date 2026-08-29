import React, { useEffect, useRef, useState } from "react";

/**
 * 3D Face Biometric Particle Mesh & Laser Sweep Scene.
 * Features rotating low-poly head landmark geometry, glowing scanning plane,
 * mouse parallax, and orbiting translucent glassmorphism status chips.
 */
export default function ThreeDFaceCanvas({ compact = false, showChips = true }) {
  const canvasRef = useRef(null);
  const [activeChipIndex, setActiveChipIndex] = useState(0);

  const chips = [
    { text: "✨ Face Matched — 98.2%", icon: "✓", color: "#14B8A6" },
    { text: "⚡ Attendance Marked", icon: "🕒 09:41 AM", color: "#3B82F6" },
    { text: "👤 57 Students Recognized", icon: "CS-3A", color: "#06B6D4" },
  ];

  // Cycle floating status chip index every 2.8s
  useEffect(() => {
    if (!showChips) return;
    const interval = setInterval(() => {
      setActiveChipIndex((prev) => (prev + 1) % chips.length);
    }, 2800);
    return () => clearInterval(interval);
  }, [showChips]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animationFrameId;

    let width = (canvas.width = canvas.parentElement.clientWidth || 500);
    let height = (canvas.height = canvas.parentElement.clientHeight || 450);

    const handleResize = () => {
      if (!canvas || !canvas.parentElement) return;
      width = canvas.width = canvas.parentElement.clientWidth;
      height = canvas.height = canvas.parentElement.clientHeight;
    };

    window.addEventListener("resize", handleResize);

    // 3D Nodes generation representing stylized face mesh
    const numNodes = compact ? 50 : 90;
    const nodes = [];
    const radius = Math.min(width, height) * (compact ? 0.28 : 0.34);

    for (let i = 0; i < numNodes; i++) {
      const phi = Math.acos(-1 + (2 * i) / numNodes);
      const theta = Math.sqrt(numNodes * Math.PI) * phi;
      nodes.push({
        x: radius * Math.cos(theta) * Math.sin(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(phi),
        pulse: Math.random() * Math.PI * 2,
      });
    }

    // Facial landmark features (Eyes, Nose, Mouth, Jaw, Brow contours)
    const landmarks = [
      { x: -38, y: -28, z: 80, label: "Left Eye" },
      { x: 38, y: -28, z: 80, label: "Right Eye" },
      { x: 0, y: 5, z: 102, label: "Nose Tip" },
      { x: 0, y: 42, z: 85, label: "Chin" },
      { x: -30, y: 32, z: 78, label: "Mouth-L" },
      { x: 30, y: 32, z: 78, label: "Mouth-R" },
      { x: -58, y: -48, z: 55, label: "Brow-L" },
      { x: 58, y: -48, z: 55, label: "Brow-R" },
    ];

    let angleX = 0.003;
    let angleY = 0.006;
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;
    let scanY = -radius;
    let scanDir = 1;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      targetMouseX = (e.clientX - rect.left - rect.width / 2) * 0.0006;
      targetMouseY = (e.clientY - rect.top - rect.height / 2) * 0.0006;
    };

    window.addEventListener("mousemove", handleMouseMove);

    const rotate3D = (node, rx, ry) => {
      const cosY = Math.cos(ry);
      const sinY = Math.sin(ry);
      const x1 = node.x * cosY - node.z * sinY;
      const z1 = node.z * cosY + node.x * sinY;

      const cosX = Math.cos(rx);
      const sinX = Math.sin(rx);
      const y2 = node.y * cosX - z1 * sinX;
      const z2 = z1 * cosX + node.y * sinX;

      return { x: x1, y: y2, z: z2 };
    };

    let frame = 0;

    const render = () => {
      frame++;
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      // Mouse Parallax Easing
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      const curAngleY = angleY + mouseX;
      const curAngleX = angleX + mouseY;

      // Render wireframe mesh
      const projNodes = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const rot = rotate3D(n, curAngleX, curAngleY);
        n.x = rot.x;
        n.y = rot.y;
        n.z = rot.z;

        const fov = 420;
        const scale = fov / (fov + n.z + 200);
        const px = cx + n.x * scale;
        const py = cy + n.y * scale;

        projNodes.push({ px, py, scale, z: n.z });
      }

      // Connecting 3D wireframe edges
      ctx.lineWidth = 0.8;
      for (let i = 0; i < projNodes.length; i++) {
        for (let j = i + 1; j < projNodes.length; j++) {
          const n1 = projNodes[i];
          const n2 = projNodes[j];
          const dx = n1.px - n2.px;
          const dy = n1.py - n2.py;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 68) {
            const alpha = (1 - dist / 68) * 0.32 * Math.max(0, (n1.z + radius) / (radius * 2));
            ctx.strokeStyle = `rgba(20, 184, 166, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(n1.px, n1.py);
            ctx.lineTo(n2.px, n2.py);
            ctx.stroke();
          }
        }
      }

      // Nodes rendering
      for (let i = 0; i < projNodes.length; i++) {
        const n = projNodes[i];
        const alpha = Math.max(0.15, (n.z + radius) / (radius * 2));
        const rSize = Math.max(1, 2.2 * n.scale);

        ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`;
        ctx.beginPath();
        ctx.arc(n.px, n.py, rSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3D Facial Landmarks with Reticles
      if (!compact) {
        landmarks.forEach((lm) => {
          const rot = rotate3D(lm, curAngleX, curAngleY);
          const fov = 420;
          const scale = fov / (fov + rot.z + 200);
          const px = cx + rot.x * scale;
          const py = cy + rot.y * scale;

          if (rot.z > -10) {
            ctx.strokeStyle = "#14B8A6";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "#38BDF8";
            ctx.fillRect(px - 1.5, py - 1.5, 3, 3);

            ctx.font = "9px 'JetBrains Mono', monospace";
            ctx.fillStyle = "rgba(20, 184, 166, 0.85)";
            ctx.fillText(lm.label, px + 8, py + 3);
          }
        });
      }

      // Laser Scanner Sweep Plane
      scanY += 1.6 * scanDir;
      if (scanY > radius || scanY < -radius) scanDir *= -1;

      const scanScale = 420 / (420 + 200);
      const curScanY = cy + scanY * scanScale;

      const grad = ctx.createLinearGradient(0, curScanY - 14, 0, curScanY + 14);
      grad.addColorStop(0, "rgba(20, 184, 166, 0)");
      grad.addColorStop(0.5, "rgba(20, 184, 166, 0.55)");
      grad.addColorStop(1, "rgba(20, 184, 166, 0)");

      ctx.fillStyle = grad;
      ctx.fillRect(cx - radius * 1.2, curScanY - 10, radius * 2.4, 20);

      ctx.strokeStyle = "#38BDF8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - radius * 1.15, curScanY);
      ctx.lineTo(cx + radius * 1.15, curScanY);
      ctx.stroke();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [compact]);

  return (
    <div className="three-d-canvas-wrapper" style={{ position: "relative", width: "100%", height: "100%", minHeight: compact ? "260px" : "440px" }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          borderRadius: "20px",
          background: "radial-gradient(ellipse at center, rgba(20, 184, 166, 0.08) 0%, rgba(9, 13, 22, 0.95) 75%)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6), inset 0 0 0 1px rgba(20, 184, 166, 0.25)",
        }}
      />

      {/* Floating Translucent Glassmorphism Status Cards */}
      {showChips && !compact && (
        <div
          className="floating-chips-container"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            display: "flex",
            flexDirection: "column",
            justify: "space-between",
            padding: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
            <div
              className="glass-chip"
              style={{
                background: "rgba(15, 23, 42, 0.75)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(20, 184, 166, 0.4)",
                padding: "8px 14px",
                borderRadius: "12px",
                color: "#14B8A6",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                transition: "all 0.5s ease",
                opacity: activeChipIndex === 0 ? 1 : 0.4,
                transform: activeChipIndex === 0 ? "scale(1.05) translateY(0)" : "scale(0.95) translateY(4px)",
              }}
            >
              {chips[0].text}
            </div>
            <div
              className="glass-chip"
              style={{
                background: "rgba(15, 23, 42, 0.75)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(59, 130, 246, 0.4)",
                padding: "8px 14px",
                borderRadius: "12px",
                color: "#60A5FA",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                transition: "all 0.5s ease",
                opacity: activeChipIndex === 1 ? 1 : 0.4,
                transform: activeChipIndex === 1 ? "scale(1.05) translateY(0)" : "scale(0.95) translateY(4px)",
              }}
            >
              {chips[1].text}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            <div
              className="glass-chip"
              style={{
                background: "rgba(15, 23, 42, 0.75)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(6, 182, 212, 0.4)",
                padding: "8px 16px",
                borderRadius: "12px",
                color: "#38BDF8",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
                transition: "all 0.5s ease",
                opacity: activeChipIndex === 2 ? 1 : 0.4,
                transform: activeChipIndex === 2 ? "scale(1.05) translateY(0)" : "scale(0.95) translateY(4px)",
              }}
            >
              {chips[2].text}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
