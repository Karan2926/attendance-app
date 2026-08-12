// Empty-state placeholder for lists/tables with no data.
export default function EmptyState({ title = "Nothing here yet", hint, icon = "▫" }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      {hint && <div className="empty-state-hint">{hint}</div>}
    </div>
  );
}
