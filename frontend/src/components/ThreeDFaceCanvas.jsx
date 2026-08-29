import React, { useEffect, useRef } from "react";

/**
 * Interactive 3D Biometric Face Mesh & Neural Particle Canvas.
 * Renders a 3D rotating face-scanning grid with laser sweeps and mouse parallax.
 */
export default function ThreeDFaceCanvas() {
  const canvasRef = useRef(null);

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

    // 3D Sphere & Face Landmark Mesh Generation
    const numNodes = 75;
    const nodes = [];
    const radius = Math.min(width, height) * 0.32;

    for (let i = 0; i < numNodes; i++) {
      const phi = Math.acos(-1 + (2 * i) / numNodes);
      const theta = Math.sqrt(numNodes * Math.PI) * phi;
      nodes.push({
        x: radius * Math.cos(theta) * Math.sin(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(phi),
        baseX: radius * Math.cos(theta) * Math.sin(phi),
        baseY: radius * Math.sin(theta) * Math.sin(phi),
        baseZ: radius * Math.cos(phi),
        pulse: Math.random() * Math.PI * 2,
      });
    }

    // Facial landmark facial feature coordinates (Eye, Nose, Mouth wireframe)
    const landmarks = [
      { x: -35, y: -25, z: 75, label: "Eye-L" },
      { x: 35, y: -25, z: 75, label: "Eye-R" },
      { x: 0, y: 5, z: 95, label: "Nose Tip" },
      { x: 0, y: 38, z: 80, label: "Jaw Center" },
      { x: -28, y: 30, z: 75, label: "Mouth-L" },
      { x: 28, y: 30, z: 75, label: "Mouth-R" },
      { x: -55, y: -45, z: 50, label: "Brow-L" },
      { x: 55, y: -45, z: 50, label: "Brow-R" },
    ];

    let angleX = 0.005;
    let angleY = 0.008;
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;
    let scanY = -radius;
    let scanDirection = 1;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      targetMouseX = (e.clientX - rect.left - rect.width / 2) * 0.0008;
      targetMouseY = (e.clientY - rect.top - rect.height / 2) * 0.0008;
    };

    window.addEventListener("mousemove", handleMouseMove);

    // 3D Rotation helper
    const rotate3D = (node, rx, ry) => {
      // Rotate Y
      let cosY = Math.cos(ry);
      let sinY = Math.sin(ry);
      let x1 = node.x * cosY - node.z * sinY;
      let z1 = node.z * cosY + node.x * sinY;

      // Rotate X
      let cosX = Math.cos(rx);
      let sinX = Math.sin(rx);
      let y2 = node.y * cosX - z1 * sinX;
      let z2 = z1 * cosX + node.y * sinX;

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

      const currentAngleY = angleY + mouseX;
      const currentAngleX = angleX + mouseY;

      // Update & project nodes
      const projectedNodes = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        // Rotate 3D
        const rotated = rotate3D(n, currentAngleX, currentAngleY);
        n.x = rotated.x;
        n.y = rotated.y;
        n.z = rotated.z;

        const fov = 400;
        const scale = fov / (fov + n.z + 200);
        const px = cx + n.x * scale;
        const py = cy + n.y * scale;

        projectedNodes.push({ px, py, scale, z: n.z, pulse: n.pulse });
      }

      // Draw connecting wireframe lines between close 3D nodes
      ctx.lineWidth = 0.8;
      for (let i = 0; i < projectedNodes.length; i++) {
        for (let j = i + 1; j < projectedNodes.length; j++) {
          const n1 = projectedNodes[i];
          const n2 = projectedNodes[j];
          const dx = n1.px - n2.px;
          const dy = n1.py - n2.py;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 65) {
            const alpha = (1 - dist / 65) * 0.35 * Math.max(0, (n1.z + radius) / (radius * 2));
            ctx.strokeStyle = `rgba(16, 185, 129, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(n1.px, n1.py);
            ctx.lineTo(n2.px, n2.py);
            ctx.stroke();
          }
        }
      }

      // Draw projected nodes
      for (let i = 0; i < projectedNodes.length; i++) {
        const n = projectedNodes[i];
        const alpha = Math.max(0.2, (n.z + radius) / (radius * 2));
        const radiusSize = Math.max(1, 2.5 * n.scale);

        ctx.fillStyle = `rgba(52, 211, 153, ${alpha})`;
        ctx.beginPath();
        ctx.arc(n.px, n.py, radiusSize, 0, Math.PI * 2);
        ctx.fill();
      }

      // Render 3D Facial Landmark Target Points
      const projectedLandmarks = [];
      landmarks.forEach((lm) => {
        const rot = rotate3D(lm, currentAngleX, currentAngleY);
        const fov = 400;
        const scale = fov / (fov + rot.z + 200);
        const px = cx + rot.x * scale;
        const py = cy + rot.y * scale;
        projectedLandmarks.push({ px, py, z: rot.z, label: lm.label });

        if (rot.z > -20) {
          // Draw Glowing Biometric Target Reticle
          ctx.strokeStyle = "#06b6d4";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = "#34d399";
          ctx.fillRect(px - 1, py - 1, 2, 2);

          // Render small vector data tag
          ctx.font = "9px 'JetBrains Mono', monospace";
          ctx.fillStyle = "rgba(6, 182, 212, 0.85)";
          ctx.fillText(lm.label, px + 8, py + 3);
        }
      });

      // Draw Laser Scanning Sweep Line across the 3D Grid
      scanY += 1.8 * scanDirection;
      if (scanY > radius || scanY < -radius) scanDirection *= -1;

      const scanScale = 400 / (400 + 200);
      const currentScanY = cy + scanY * scanScale;

      const grad = ctx.createLinearGradient(0, currentScanY - 12, 0, currentScanY + 12);
      grad.addColorStop(0, "rgba(6, 182, 212, 0)");
      grad.addColorStop(0.5, "rgba(52, 211, 153, 0.65)");
      grad.addColorStop(1, "rgba(6, 182, 212, 0)");

      ctx.fillStyle = grad;
      ctx.fillRect(cx - radius * 1.2, currentScanY - 8, radius * 2.4, 16);

      // Scanning indicator bar line
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - radius * 1.1, currentScanY);
      ctx.lineTo(cx + radius * 1.1, currentScanY);
      ctx.stroke();

      // Top Overlay HUD Tag
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#10b981";
      ctx.fillText(`[3D BIOMETRIC SCAN · ACTIVE]`, cx - 90, cy - radius * 1.15);

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <div className="three-d-container" style={{ position: "relative", width: "100%", height: "100%", minHeight: "380px" }}>
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          borderRadius: "16px",
          background: "radial-gradient(circle at center, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.95) 75%)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4), inset 0 0 0 1px rgba(52, 211, 153, 0.2)",
        }}
      />
      <div
        className="three-d-badge"
        style={{
          position: "absolute",
          bottom: "16px",
          right: "16px",
          background: "rgba(15, 23, 42, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid rgba(52, 211, 153, 0.3)",
          borderRadius: "8px",
          padding: "6px 12px",
          fontSize: "11px",
          color: "#34d399",
          fontFamily: "'JetBrains Mono', monospace",
          pointerEvents: "none",
        }}
      >
        ⚡ Real-time 3D Biometric Mesh
      </div>
    </div>
  );
}
