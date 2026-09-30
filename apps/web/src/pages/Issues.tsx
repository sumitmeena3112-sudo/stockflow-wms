import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, getUser } from "../api";
import { ISSUE_TYPES, fmtDate } from "../ui";

export default function Issues() {
  const [issues, setIssues] = useState<any[]>([]);
  const [filter, setFilter] = useState("OPEN");
  const [orders, setOrders] = useState<any[]>([]);
  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState("OTHER");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = () => api(`/issues${filter ? `?status=${filter}` : ""}`).then(setIssues);
  useEffect(() => {
    load();
  }, [filter]);
  useEffect(() => {
    api("/orders").then(setOrders);
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/issues", "POST", { orderId: orderId || undefined, type, description: text });
      setText("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function resolve(id: string) {
    const note = window.prompt("How was it resolved?");
    if (!note) return;
    try {
      await api(`/issues/${id}/resolve`, "POST", { note });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Issues</h1>
      <p className="muted">Every problem is written down and stays open until someone resolves it. Wrong scans, short stock and delivery differences are logged automatically.</p>

      <form className="card row" onSubmit={add}>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(ISSUE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">No specific order</option>
          {orders.map((o) => <option key={o.id} value={o.id}>{o.reference} – {o.customer}</option>)}
        </select>
        <input className="wide" placeholder="What happened?" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={text.trim().length < 3}>Log problem</button>
      </form>
      {error && <p className="error">{error}</p>}

      <div className="row">
        {["OPEN", "RESOLVED", ""].map((f) => (
          <button key={f} className={filter === f ? "" : "ghost"} onClick={() => setFilter(f)}>
            {f === "" ? "All" : f === "OPEN" ? "Open" : "Resolved"}
          </button>
        ))}
      </div>

      <table>
        <thead><tr><th>When</th><th>Type</th><th>Order</th><th>What happened</th><th>By</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {issues.map((i) => (
            <tr key={i.id}>
              <td>{fmtDate(i.createdAt)}</td>
              <td>{ISSUE_TYPES[i.type] ?? i.type}</td>
              <td>{i.order ? <Link to={`/orders/${i.order.id}`}>{i.order.reference}</Link> : ""}</td>
              <td>{i.description}{i.resolutionNote && <div className="muted small">Resolved: {i.resolutionNote}</div>}</td>
              <td className="muted small">{i.reportedBy}</td>
              <td><span className={`badge ${i.status === "OPEN" ? "CANCELLED" : "SHIPPED"}`}>{i.status}</span></td>
              <td>{isAdmin && i.status === "OPEN" && <button className="ghost" onClick={() => resolve(i.id)}>Resolve</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {issues.length === 0 && <p className="muted">No issues here.</p>}
    </>
  );
}
