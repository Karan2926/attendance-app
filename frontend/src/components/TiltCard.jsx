import React, { useRef, useState } from "react";

/**
 * 3D Interactive Tilt Card Component (Vercel / Apple product page style).
 * Tracks mouse position over the card and applies 3D perspective rotation + spotlight sheen.
 */
export default function TiltCard({ children, className = "", style = {} }) {
  const cardRef = useRef(null);
  const [transform, setTransform] = useState("perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)");
  const [glare, setGlare] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = (e) => {
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -12; // max tilt deg
    const rotateY = ((x - centerX) / centerX) * 12;

    setTransform(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`);

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;
    setGlare({ x: glareX, y: glareY, opacity: 0.25 });
  };

  const handleMouseLeave = () => {
    setTransform("perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)");
    setGlare({ x: 50, y: 50, opacity: 0 });
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`tilt-card ${className}`}
      style={{
        transform,
        transition: "transform 0.15s cubic-bezier(0.2, 0, 0.2, 1), box-shadow 0.15s ease",
        transformStyle: "preserve-3d",
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        className="tilt-glare"
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at ${glare.x}% ${glare.y}%, rgba(20, 184, 166, ${glare.opacity}), transparent 60%)`,
          pointerEvents: "none",
          borderRadius: "inherit",
          transition: "opacity 0.2s ease",
        }}
      />
      <div style={{ transform: "translateZ(20px)" }}>{children}</div>
    </div>
  );
}
