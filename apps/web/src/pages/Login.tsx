import { FormEvent, useState } from "react";
import { api, saveSession } from "../api";

export default function Login() {
  const [email, setEmail] = useState("admin@stockflow.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { token, user } = await api("/auth/login", "POST", { email, password });
      saveSession(token, user);
      window.location.href = "/";
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h2>StockFlow WMS</h2>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">Sign in</button>
        <p className="muted small">Demo: admin@stockflow.local / Admin@12345</p>
      </form>
    </div>
  );
}
