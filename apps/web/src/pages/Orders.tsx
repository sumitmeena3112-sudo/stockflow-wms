import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getUser } from "../api";

export default function Orders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [customer, setCustomer] = useState("");
  const [lines, setLines] = useState<{ productId: string; quantity: number }[]>([
    { productId: "", quantity: 1 },
  ]);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const isAdmin = getUser()?.role === "ADMIN";

  useEffect(() => {
    api("/orders").then(setOrders);
    api("/products").then(setProducts);
  }, []);

  const setLine = (i: number, patch: object) =>
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const order = await api("/orders", "POST", {
        customer,
        lines: lines.filter((l) => l.productId),
      });
      navigate(`/orders/${order.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Orders</h1>
      {isAdmin && (
        <form className="card" onSubmit={create}>
          <div className="row">
            <strong>New order</strong>
            <input placeholder="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} />
          </div>
          {lines.map((l, i) => (
            <div className="row" key={i}>
              <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                <option value="">Product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.sku} – {p.name}</option>)}
              </select>
              <input type="number" min={1} value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} />
            </div>
          ))}
          <div className="row">
            <button type="button" className="ghost" onClick={() => setLines([...lines, { productId: "", quantity: 1 }])}>
              + Add line
            </button>
            <button type="submit" disabled={!customer}>Create order</button>
            {error && <span className="error">{error}</span>}
          </div>
        </form>
      )}
      <table>
        <thead><tr><th>Reference</th><th>Customer</th><th>Lines</th><th>Status</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link to={`/orders/${o.id}`}>{o.reference}</Link></td>
              <td>{o.customer}</td>
              <td>{o.lines.length}</td>
              <td><span className={`badge ${o.status}`}>{o.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
