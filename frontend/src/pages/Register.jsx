import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import usePageTitle from "../components/usePageTitle";
import Brand from "../components/Brand";

export default function Register() {

  usePageTitle('Register');
  const navigate = useNavigate();
  const [roll, setRoll] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api.post("/auth/register", {
        roll: roll.trim(),
        username: username.trim(),
        password,
      });
      navigate("/my_attendance");
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
        <h1 className="auth-brand">Create your account</h1>
        <p className="auth-sub">Use the roll number your teacher already registered for you.</p>

        {error && <div className="error-text mono">{error}</div>}

        <form onSubmit={onSubmit}>
          <label className="label2">Your roll number</label>
          <input
            className="input2 mb-3"
            value={roll}
            onChange={(e) => setRoll(e.target.value)}
            required
            placeholder="Must match what your teacher added"
          />
          <label className="label2">Choose a username</label>
          <input
            className="input2 mb-3"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <label className="label2">Choose a password</label>
          <input
            className="input2 mb-3"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength="8"
          />
          <button type="submit" className="btn2 btn2-primary w-100" disabled={busy}>
            {busy ? "Creating…" : "Create Account"}
          </button>
        </form>
        <div className="mt-3 text-center">
          <Link to="/login" className="auth-link">
            Already have an account? Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
