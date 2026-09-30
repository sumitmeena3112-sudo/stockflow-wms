import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getUser } from "../api";

export default function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = () => api(`/orders/${id}`).then(setOrder);
  useEffect(() => {
    load();
  }, [id]);

  async function act(path: string) {
    setError("");
    try {
      setOrder(await api(`/orders/${id}/${path}`, "POST"));
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!order) return <p>Loading…</p>;
  const canPick = order.status === "CONFIRMED" || order.status === "PICKING";

  return (
    <>
      <p><Link to="/orders">← Orders</Link></p>
      <h1>
        {order.reference} <span className={`badge ${order.status}`}>{order.status}</span>
      </h1>
      <p className="muted">Customer: {order.customer}</p>

      <div className="row">
        {isAdmin && order.status === "DRAFT" && <button onClick={() => act("confirm")}>Confirm &amp; reserve stock</button>}
        {isAdmin && order.status === "PACKED" && <button onClick={() => act("ship")}>Mark shipped</button>}
        {isAdmin && !["SHIPPED", "CANCELLED"].includes(order.status) && (
          <button className="danger" onClick={() => act("cancel")}>Cancel order</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <h2>Pick list</h2>
      <table>
        <thead>
          <tr><th>SKU</th><th>Product</th><th>Ordered</th><th>Picked</th><th>Bin</th><th>Qty from bin</th><th></th></tr>
        </thead>
        <tbody>
          {order.lines.flatMap((line: any) =>
            line.allocations.length === 0 ? (
              <tr key={line.id}>
                <td>{line.product.sku}</td><td>{line.product.name}</td>
                <td>{line.quantity}</td><td>{line.picked}</td>
                <td colSpan={3} className="muted">Not reserved yet</td>
              </tr>
            ) : (
              line.allocations.map((a: any) => (
                <tr key={a.id}>
                  <td>{line.product.sku}</td><td>{line.product.name}</td>
                  <td>{line.quantity}</td><td>{line.picked}</td>
                  <td>{a.stockLevel.location.code}</td>
                  <td>{a.quantity}</td>
                  <td>
                    {a.picked ? "✓ picked" : canPick && (
                      <button onClick={() => act(`allocations/${a.id}/pick`)}>Mark picked</button>
                    )}
                  </td>
                </tr>
              ))
            ),
          )}
        </tbody>
      </table>
    </>
  );
}
