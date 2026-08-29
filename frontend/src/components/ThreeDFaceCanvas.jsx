import React, { useEffect, useRef, useState } from "react";

/**
 * Procedural 3D Low-Poly Human Head & Biometric Scanning Mesh.
 * Models an abstract, low-poly triangulated human head topology with laser sweeps,
 * emissive nodes, mouse rotation parallax, and floating status chips.
 */
export default function ThreeDFaceCanvas({ compact = false, showChips = true }) {
  const canvasRef = useRef(null);
  const [activeChipIndex, setActiveChipIndex] = useState(0);

  const chips = [
    { text: "✨ Face Matched — 98.2%", icon: "✓", color: "#059669" },
    { text: "⚡ Attendance Marked", icon: "🕒 09:41 AM", color: "#1D4ED8" },
    { text: "👤 57 Students Recognized", icon: "CS-3A", color: "#D97706" },
  ];

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

    // -----------------------------------------------------------------------
    // Low-Poly Anatomical Human Head Mesh Geometry (3D Vertices)
    // -----------------------------------------------------------------------
    const rawHeadVertices = [
      // Crown & Forehead
      { x: 0, y: -130, z: 0 },
      { x: -45, y: -115, z: 30 }, { x: 45, y: -115, z: 30 },
      { x: -75, y: -90, z: 15 },  { x: 75, y: -90, z: 15 },
      { x: -50, y: -80, z: 65 },  { x: 50, y: -80, z: 65 },
      { x: 0, y: -85, z: 75 },

      // Eyebrow Ridge & Temples
      { x: -65, y: -45, z: 70 }, { x: -25, y: -45, z: 85 },
      { x: 0, y: -45, z: 90 },
      { x: 25, y: -45, z: 85 },  { x: 65, y: -45, z: 70 },
      { x: -85, y: -40, z: 20 }, { x: 85, y: -40, z: 20 },

      // Eye Sockets & Nose Bridge
      { x: -40, y: -25, z: 75 }, { x: -15, y: -25, z: 82 },
      { x: 0, y: -20, z: 98 },   { x: 15, y: -25, z: 82 }, { x: 40, y: -25, z: 75 },

      // Cheekbones & Nose Tip
      { x: -75, y: -10, z: 50 }, { x: -45, y: -5, z: 70 },
      { x: 0, y: 5, z: 112 },    // Nose Tip
      { x: 45, y: -5, z: 70 },   { x: 75, y: -10, z: 50 },

      // Nostrils & Upper Lip
      { x: -20, y: 18, z: 88 },  { x: 0, y: 22, z: 95 },  { x: 20, y: 18, z: 88 },
      { x: -40, y: 20, z: 65 },  { x: 40, y: 20, z: 65 },

      // Mouth Line & Cheeks
      { x: -35, y: 40, z: 75 },  { x: 0, y: 42, z: 88 },  { x: 35, y: 40, z: 75 },
      { x: -70, y: 30, z: 35 },  { x: 70, y: 30, z: 35 },

      // Lower Lip, Chin & Jawline
      { x: -25, y: 60, z: 78 },  { x: 0, y: 62, z: 84 },  { x: 25, y: 60, z: 78 },
      { x: -55, y: 65, z: 45 },  { x: 55, y: 65, z: 45 },
      { x: -30, y: 90, z: 65 },  { x: 0, y: 100, z: 72 }, { x: 30, y: 90, z: 65 }, // Chin tip
      { x: -65, y: 75, z: 15 },  { x: 65, y: 75, z: 15 }, // Jaw angles
    ];

    const headScale = compact ? 1.0 : 1.35;
    const nodes = rawHeadVertices.map((v) => ({
      x: v.x * headScale,
      y: v.y * headScale,
      z: v.z * headScale,
      baseX: v.x * headScale,
      baseY: v.y * headScale,
      baseZ: v.z * headScale,
    }));

    // Facial Landmark Reticle Targets
    const landmarks = [
      { x: -30 * headScale, y: -30 * headScale, z: 80 * headScale, label: "Left Eye" },
      { x: 30 * headScale,  y: -30 * headScale, z: 80 * headScale, label: "Right Eye" },
      { x: 0,              y: 5 * headScale,   z: 112 * headScale, label: "Nose Tip" },
      { x: 0,              y: 100 * headScale, z: 72 * headScale, label: "Chin Tip" },
      { x: -35 * headScale, y: 40 * headScale,  z: 75 * headScale, label: "Mouth-L" },
      { x: 35 * headScale,  y: 40 * headScale,  z: 75 * headScale, label: "Mouth-R" },
    ];

    let angleX = 0.002;
    let angleY = 0.005;
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;
    let scanY = -120 * headScale;
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
      const cy = height / 2 + 10;

      // Mouse Parallax Easing
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;

      const curAngleY = angleY + mouseX;
      const curAngleX = angleX + mouseY;

      // Transform 3D Head Mesh
      const projNodes = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const rot = rotate3D(n, curAngleX, curAngleY);
        n.x = rot.x;
        n.y = rot.y;
        n.z = rot.z;

        const fov = 450;
        const scale = fov / (fov + n.z + 180);
        const px = cx + n.x * scale;
        const py = cy + n.y * scale;

        projNodes.push({ px, py, scale, z: n.z });
      }

      // Triangulated Low-Poly Wireframe Edges
      ctx.lineWidth = 1.1;
      for (let i = 0; i < projNodes.length; i++) {
        for (let j = i + 1; j < projNodes.length; j++) {
          const n1 = projNodes[i];
          const n2 = projNodes[j];
          const dx = n1.px - n2.px;
          const dy = n1.py - n2.py;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 62 * headScale) {
            const alpha = (1 - dist / (62 * headScale)) * 0.42 * Math.max(0.1, (n1.z + 120) / 240);
            ctx.strokeStyle = `rgba(30, 58, 138, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(n1.px, n1.py);
            ctx.lineTo(n2.px, n2.py);
            ctx.stroke();
          }
        }
      }

      // Render Low-Poly Facet Vertices
      for (let i = 0; i < projNodes.length; i++) {
        const n = projNodes[i];
        const alpha = Math.max(0.2, (n.z + 120) / 240);
        const rSize = Math.max(1.2, 2.6 * n.scale);

        ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
        ctx.beginPath();
        ctx.arc(n.px, n.py, rSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // Render Biometric Facial Landmark Markers
      if (!compact) {
        landmarks.forEach((lm) => {
          const rot = rotate3D(lm, curAngleX, curAngleY);
          const fov = 450;
          const scale = fov / (fov + rot.z + 180);
          const px = cx + rot.x * scale;
          const py = cy + rot.y * scale;

          if (rot.z > -10) {
            ctx.strokeStyle = "#2563EB";
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = "#10B981";
            ctx.fillRect(px - 1.5, py - 1.5, 3, 3);

            ctx.font = "600 10px 'JetBrains Mono', monospace";
            ctx.fillStyle = "#1E3A8A";
            ctx.fillText(lm.label, px + 8, py + 3);
          }
        });
      }

      // Laser Scanner Sweep Plane over Low-Poly Head
      scanY += 1.8 * scanDir;
      const maxScanRange = 110 * headScale;
      if (scanY > maxScanRange || scanY < -maxScanRange) scanDir *= -1;

      const scanScale = 450 / (450 + 180);
      const curScanY = cy + scanY * scanScale;

      const grad = ctx.createLinearGradient(0, curScanY - 14, 0, curScanY + 14);
      grad.addColorStop(0, "rgba(16, 185, 129, 0)");
      grad.addColorStop(0.5, "rgba(16, 185, 129, 0.45)");
      grad.addColorStop(1, "rgba(16, 185, 129, 0)");

      ctx.fillStyle = grad;
      ctx.fillRect(cx - 130 * headScale, curScanY - 10, 260 * headScale, 20);

      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cx - 120 * headScale, curScanY);
      ctx.lineTo(cx + 120 * headScale, curScanY);
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
          background: "radial-gradient(ellipse at center, rgba(238, 242, 255, 0.95) 0%, rgba(243, 246, 251, 0.98) 75%)",
          boxShadow: "0 20px 40px rgba(15, 30, 53, 0.08), inset 0 0 0 1px rgba(30, 58, 138, 0.12)",
        }}
      />

      {/* Floating Status Chips */}
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
                background: "rgba(255, 255, 255, 0.88)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                padding: "8px 14px",
                borderRadius: "12px",
                color: "#047857",
                fontWeight: "600",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 8px 24px rgba(15, 30, 53, 0.08)",
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
                background: "rgba(255, 255, 255, 0.88)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(37, 99, 235, 0.4)",
                padding: "8px 14px",
                borderRadius: "12px",
                color: "#1D4ED8",
                fontWeight: "600",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 8px 24px rgba(15, 30, 53, 0.08)",
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
                background: "rgba(255, 255, 255, 0.88)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(217, 119, 6, 0.4)",
                padding: "8px 16px",
                borderRadius: "12px",
                color: "#B45309",
                fontWeight: "600",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', monospace",
                boxShadow: "0 8px 24px rgba(15, 30, 53, 0.08)",
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
