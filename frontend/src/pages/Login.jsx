import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import usePageTitle from "../components/usePageTitle";
import Brand from "../components/Brand";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  usePageTitle("Sign in");

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(username.trim(), password);
      navigate(user.role === "student" ? "/my_attendance" : "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="mb-3">
          <Brand />
        </div>
        <h1 className="auth-brand">Digital Attendance</h1>
        <p className="auth-sub">
          Sign in to mark class, review records, or check your presence.
        </p>

        {error && <div className="error-text mono">{error}</div>}

        <form onSubmit={onSubmit}>
          <label className="label2">Username</label>
          <input
            className="input2 mb-3"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
          <label className="label2">Password</label>
          <input
            className="input2 mb-3"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <button type="submit" className="btn2 btn2-primary w-100" disabled={busy}>
            {busy ? "Logging in…" : "Log In"}
          </button>
        </form>
        <div className="mt-3 text-center">
          <Link to="/register" className="auth-link">
            Student? Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
