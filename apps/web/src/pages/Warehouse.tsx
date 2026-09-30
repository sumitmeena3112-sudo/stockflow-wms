import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { OrderTable, ProductName, fmtDate } from "../ui";

export default function Warehouse() {
  const [t, setT] = useState<any>(null);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => api("/tasks").then(setT).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    api("/locations").then((ls: any[]) => setLocations(Object.fromEntries(ls.map((l) => [l.id, l.code]))));
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  async function run(fn: () => Promise<any>, message: string) {
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(message);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (!t) return <p>{error || "Loading…"}</p>;

  return (
    <>
      <h1>Warehouse tasks</h1>
      <p className="muted">Most urgent first: priority orders, then the earliest deadline.</p>
      {error && <p className="error">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <h2>1. Move stock from overflow <span className="count">{t.transfers.length}</span></h2>
      {t.transfers.length === 0 ? (
        <p className="muted">Nothing to move.</p>
      ) : (
        <table>
          <thead><tr><th>Order</th><th>Item</th><th>Qty</th><th>From</th><th>To</th><th></th></tr></thead>
          <tbody>
            {t.transfers.map((a: any) => (
              <tr key={a.id}>
                <td><Link to={`/orders/${a.orderLine.orderId}`}>{a.orderLine.order.reference}</Link></td>
                <td>{a.orderLine.product.sku}</td>
                <td>{a.quantity}</td>
                <td>{a.stockLevel.location.code}</td>
                <td>{locations[a.transferToLocationId] ?? "main bin"}</td>
                <td>
                  <button className="big" onClick={() => run(() => api(`/allocations/${a.id}/transfer`, "POST"), "Stock moved to the main warehouse.")}>
                    Moved it
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>2. Pick <span className="count">{t.pick.length}</span></h2>
      <OrderTable orders={t.pick} empty="No orders to pick." />

      <h2>3. Pack and stage <span className="count">{t.pack.length}</span></h2>
      <OrderTable orders={t.pack} empty="No orders waiting to be packed." />

      <h2>4. Courier pickups</h2>
      {t.pickups.length === 0 ? (
        <p className="muted">No boxes are staged.</p>
      ) : (
        t.pickups.map((p: any) => (
          <div key={p.courier.id} className="card">
            <div className="row">
              <strong>{p.courier.name}</strong>
              <span className="muted">pickup {p.courier.pickupTime} · lane LANE-{p.courier.code}</span>
              <span className="spacer" />
              <button
                className="big"
                onClick={() =>
                  run(() => api(`/couriers/${p.courier.id}/pickup`, "POST"), `Handed ${p.orders.length} box(es) to ${p.courier.name}.`)
                }
              >
                Courier arrived: hand over {p.orders.length} box{p.orders.length === 1 ? "" : "es"}
              </button>
            </div>
            <OrderTable orders={p.orders} empty="" />
          </div>
        ))
      )}

      <h2>5. Inbound deliveries <span className="count">{t.inbound.length}</span></h2>
      {t.inbound.length === 0 ? (
        <p className="muted">No deliveries to unload.</p>
      ) : (
        <table>
          <thead><tr><th>Delivery</th><th>Supplier</th><th>Expected</th><th>Step</th></tr></thead>
          <tbody>
            {t.inbound.map((d: any) => (
              <tr key={d.id}>
                <td><Link to="/deliveries">{d.reference}</Link></td>
                <td>{d.supplier}</td>
                <td>{fmtDate(d.expectedAt)}</td>
                <td>{d.status === "EXPECTED" ? "Count it" : "Put away on shelves"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
