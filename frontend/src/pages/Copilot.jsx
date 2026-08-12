import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import usePageTitle from "../components/usePageTitle";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

export default function Copilot() {

  usePageTitle('AI Copilot');
  const [messages, setMessages] = useState([
    { role: "bot", text: 'Hi — I can answer attendance questions from your database.\nTry: Who is absent today in <class> / <subject>?', meta: "copilot ready" },
  ]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  async function ask(q) {
    q = (q || "").trim();
    if (!q) return;
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setQuery("");
    setBusy(true);
    try {
      const data = await api.post("/copilot", { query: q });
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: data.answer || "No answer", meta: data.intent ? `intent: ${data.intent}` : "" },
      ]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "bot", text: err.message || "Network error talking to copilot.", meta: "error" }]);
    } finally {
      setBusy(false);
    }
  }

  const chips = [
    "Who is absent today?",
    "Who is present today?",
    "Flag students with less than 75% attendance",
    "Summarize today's classroom photo session",
    "help",
  ];

  return (
    <div className="page">
      <div style={{ maxWidth: "880px", margin: "0 auto" }}>
        <span className="eyebrow">Rules-based AI assistant</span>
        <h1 className="panel-title" style={{ marginTop: "0.35rem" }}>
          Attendance Copilot
        </h1>
        <p className="panel-copy">
          Ask about absences, at-risk students, or today’s classroom session. Uses your live
          database (no cloud LLM yet) — safe for college demos.
        </p>

        <div className="card2 mt-3">
          <div className="copilot-log" ref={logRef}>
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-bot"}`}>
                {m.meta && <div className="bubble-meta">{m.meta}</div>}
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
              </div>
            ))}
          </div>
          <div className="chip-row">
            {chips.map((c) => (
              <button key={c} type="button" className="chip" onClick={() => ask(c)}>
                {c}
              </button>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask(query);
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Who is absent today in CSE-A / DBMS?"
              autoComplete="off"
            />
            <button className="btn2 btn2-teal" type="submit" disabled={busy}>
              Ask
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
