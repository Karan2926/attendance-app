// Brand — graduation-cap mark + ITM University wordmark.
// Used in the topbar and auth pages for consistent branding.

export default function Brand({ compact = false, light = false }) {
  return (
    <span className={`brand ${compact ? "brand-compact" : ""} ${light ? "brand-light" : ""}`}>
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-text">
        <span className="brand-title">Digital Attendance</span>
        {!compact && <span className="brand-sub">ITM University</span>}
      </span>
    </span>
  );
}
