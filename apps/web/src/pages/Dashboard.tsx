import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AlertChips, PriorityBadge, STEPS, STEP_LABEL, StatusBadge, dueText } from "../ui";

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    const load = () => api("/dashboard").then(setD).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  if (!d) return <p>Loading…</p>;

  return (
    <>
      <h1>Dashboard</h1>
      <div className="stats">
        <div className="card stat"><span>{d.openOrders}</span>Open orders</div>
        <div className="card stat warn"><span>{d.priorityOpen}</span>Priority orders open</div>
        <div className={`card stat ${d.overdue ? "bad" : ""}`}><span>{d.overdue}</span>Overdue</div>
        <div className={`card stat ${d.openIssues ? "warn" : ""}`}><span>{d.openIssues}</span>Open issues</div>
        <div className="card stat"><span>{d.pendingTransfers}</span>Stock moves pending</div>
        <div className="card stat"><span>{d.deliveriesInProgress}</span>Deliveries in progress</div>
      </div>

      <h2>Order pipeline</h2>
      <div className="pipeline">
        {STEPS.map((s) => (
          <Link key={s} to={`/orders?status=${s}`} className="card stage">
            <span>{d.orders[s] ?? 0}</span>
            {STEP_LABEL[s]}
          </Link>
        ))}
      </div>

      <h2>Needs attention</h2>
      {d.attention.length === 0 ? (
        <p className="muted">Nothing is late or stuck right now.</p>
      ) : (
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Due</th><th>Why</th></tr></thead>
          <tbody>
            {d.attention.map((o: any) => (
              <tr key={o.id}>
                <td><Link to={`/orders/${o.id}`}>{o.reference}</Link> <PriorityBadge priority={o.priority} /></td>
                <td>{o.customer}</td>
                <td><StatusBadge status={o.status} /></td>
                <td>{dueText(o.dueAt)}</td>
                <td><AlertChips alerts={o.alerts} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Boxes waiting for a courier</h2>
      {d.pickups.length === 0 ? (
        <p className="muted">No staged boxes.</p>
      ) : (
        <table>
          <thead><tr><th>Courier</th><th>Pickup time</th><th>Boxes staged</th></tr></thead>
          <tbody>
            {d.pickups.map((p: any) => (
              <tr key={p.courier}><td>{p.courier}</td><td>{p.pickupTime}</td><td>{p.staged}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Stock</h2>
      <div className="stats">
        <div className="card stat"><span>{d.totalOnHand}</span>Units on hand</div>
        <div className="card stat"><span>{d.totalReserved}</span>Reserved for orders</div>
        <div className="card stat"><span>{d.overflowUnits}</span>In overflow warehouse</div>
        <div className="card stat"><span>{d.lowStockBins}</span>Low-stock bins</div>
      </div>
    </>
  );
}
