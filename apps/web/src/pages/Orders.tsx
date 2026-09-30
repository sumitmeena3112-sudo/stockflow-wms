import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, getUser } from "../api";
import { AlertChips, PriorityBadge, STEPS, STEP_LABEL, StatusBadge, dueText } from "../ui";

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const isAdmin = getUser()?.role === "ADMIN";

  const status = params.get("status") ?? "";
  const priority = params.get("priority") ?? "";
  const q = params.get("q") ?? "";
  const alertsOnly = params.get("alerts") === "1";

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace: true });
  };

  const load = () => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (priority) qs.set("priority", priority);
    if (q) qs.set("q", q);
    if (alertsOnly) qs.set("alerts", "1");
    api(`/orders?${qs}`).then(setOrders);
  };
  useEffect(load, [status, priority, q, alertsOnly]);
  useEffect(() => {
    api("/products").then(setProducts);
  }, []);

  // new order form
  const [customer, setCustomer] = useState("");
  const [channel, setChannel] = useState("Website");
  const [address, setAddress] = useState("");
  const [prio, setPrio] = useState("STANDARD");
  const [due, setDue] = useState(toLocalInput(new Date(Date.now() + 24 * 3600_000)));
  const [lines, setLines] = useState([{ productId: "", quantity: 1 }]);
  const setLine = (i: number, patch: object) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const order = await api("/orders", "POST", {
        customer,
        channel,
        address,
        priority: prio,
        dueAt: new Date(due).toISOString(),
        lines: lines.filter((l) => l.productId),
      });
      navigate(`/orders/${order.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  const received = orders.filter((o) => o.status === "RECEIVED");
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  async function processSelected() {
    setError("");
    setNotice("");
    try {
      const r = await api("/orders/process-bulk", "POST", { ids: [...selected] });
      const failed = r.results.filter((x: any) => !x.ok);
      setNotice(
        `Processed ${r.processed} order(s) with the suggested courier.` +
          (failed.length ? ` ${failed.length} failed: ${failed.map((f: any) => `${f.reference} (${f.error})`).join("; ")}` : ""),
      );
      setSelected(new Set());
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Orders</h1>
        <span className="spacer" />
        {isAdmin && <button onClick={() => setShowForm(!showForm)}>{showForm ? "Close" : "+ New order"}</button>}
      </div>

      {showForm && (
        <form className="card" onSubmit={create}>
          <div className="row">
            <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option>Website</option><option>Shopee</option><option>Amazon</option>
            </select>
            <select value={prio} onChange={(e) => setPrio(e.target.value)}>
              <option value="STANDARD">Standard</option>
              <option value="PRIORITY">Priority (same-day)</option>
            </select>
            <label className="inline">Ship by <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          </div>
          <div className="row">
            <input className="wide" placeholder="Delivery address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          {lines.map((l, i) => (
            <div className="row" key={i}>
              <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                <option value="">Product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.sku} – {p.name}{p.variant ? ` (${p.variant})` : ""}</option>
                ))}
              </select>
              <input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
            </div>
          ))}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setLines([...lines, { productId: "", quantity: 1 }])}>+ Add line</button>
            <button type="submit" disabled={!customer || !lines.some((l) => l.productId)}>Create order</button>
            {error && <span className="error">{error}</span>}
          </div>
        </form>
      )}

      <div className="row filters">
        <input placeholder="Search order or customer" value={q} onChange={(e) => setFilter("q", e.target.value)} />
        <select value={status} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">All statuses</option>
          {[...STEPS, "CANCELLED"].map((s) => <option key={s} value={s}>{STEP_LABEL[s]}</option>)}
        </select>
        <select value={priority} onChange={(e) => setFilter("priority", e.target.value)}>
          <option value="">All priorities</option>
          <option value="PRIORITY">Priority only</option>
          <option value="STANDARD">Standard only</option>
        </select>
        <label className="inline"><input type="checkbox" checked={alertsOnly} onChange={(e) => setFilter("alerts", e.target.checked ? "1" : "")} /> Late / stuck only</label>
        <span className="spacer" />
        <span className="muted small">{orders.length} orders</span>
      </div>

      {isAdmin && received.length > 0 && (
        <div className="row">
          <button
            className="ghost"
            onClick={() => setSelected(selected.size === received.length ? new Set() : new Set(received.map((o) => o.id)))}
          >
            {selected.size === received.length ? "Clear selection" : `Select all ${received.length} new orders`}
          </button>
          <button disabled={selected.size === 0} onClick={processSelected}>
            Process {selected.size || ""} selected (auto-choose courier)
          </button>
        </div>
      )}
      {error && !showForm && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <table>
        <thead>
          <tr>
            {isAdmin && <th></th>}
            <th>Order</th><th>Channel</th><th>Customer</th><th>Ship by</th><th>Status</th><th>Courier</th><th>Alerts</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              {isAdmin && (
                <td>{o.status === "RECEIVED" && <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />}</td>
              )}
              <td><Link to={`/orders/${o.id}`}>{o.reference}</Link> <PriorityBadge priority={o.priority} /></td>
              <td>{o.channel}</td>
              <td>{o.customer}</td>
              <td>{["SHIPPED", "CANCELLED"].includes(o.status) ? "" : dueText(o.dueAt)}</td>
              <td><StatusBadge status={o.status} /></td>
              <td>{o.courier?.name ?? <span className="muted">-</span>}</td>
              <td><AlertChips alerts={o.alerts} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
