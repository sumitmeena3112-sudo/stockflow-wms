import { useEffect, useState } from "react";
import { api } from "../api";

export default function Dashboard() {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    api("/dashboard").then(setD).catch(() => {});
  }, []);
  if (!d) return <p>Loading…</p>;
  return (
    <>
      <h1>Dashboard</h1>
      <div className="stats">
        <div className="card stat"><span>{d.totalOnHand}</span>Units on hand</div>
        <div className="card stat"><span>{d.totalReserved}</span>Units reserved</div>
        <div className="card stat"><span>{d.lowStockBins}</span>Low-stock bins</div>
      </div>
      <h2>Orders by status</h2>
      <div className="stats">
        {["DRAFT", "CONFIRMED", "PICKING", "PACKED", "SHIPPED", "CANCELLED"].map((s) => (
          <div key={s} className="card stat">
            <span>{d.orders[s] ?? 0}</span>
            {s}
          </div>
        ))}
      </div>
    </>
  );
}
