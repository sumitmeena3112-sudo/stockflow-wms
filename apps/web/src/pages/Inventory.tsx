import { FormEvent, useEffect, useState } from "react";
import { api, getUser } from "../api";
import { ProductName, fmtDate } from "../ui";

export default function Inventory() {
  const [rows, setRows] = useState<any[]>([]);
  const [moves, setMoves] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [filter, setFilter] = useState("");
  const [code, setCode] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [error, setError] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = async () => {
    const [inv, m, w] = await Promise.all([api("/inventory"), api("/movements"), api("/warehouses")]);
    setRows(inv);
    setMoves(m);
    setWarehouses(w);
    setWarehouseId((cur) => cur || w[0]?.id || "");
  };
  useEffect(() => {
    load();
  }, []);

  async function addBin(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/locations", "POST", { code, warehouseId });
      setCode("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const shown = filter ? rows.filter((r) => r.location.warehouse.id === filter) : rows;

  return (
    <>
      <h1>Inventory</h1>
      <p className="muted">
        Orders ship from the main warehouse. Stock in the overflow warehouse is moved over before it can be picked.
        New stock arrives through <b>Deliveries</b>.
      </p>
      <div className="row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {isAdmin && (
          <form className="row" style={{ margin: 0 }} onSubmit={addBin}>
            <input placeholder="New bin code" value={code} onChange={(e) => setCode(e.target.value)} />
            <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <button type="submit" className="ghost" disabled={!code}>Add bin</button>
          </form>
        )}
        {error && <span className="error">{error}</span>}
      </div>

      <table>
        <thead>
          <tr><th>SKU</th><th>Product</th><th>Warehouse</th><th>Bin</th><th>On hand</th><th>Reserved</th><th>Available</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} className={r.available <= 5 ? "lowrow" : ""}>
              <td>{r.product.sku}</td>
              <td><ProductName p={r.product} /></td>
              <td>{r.location.warehouse.name}</td>
              <td>{r.location.code}</td>
              <td>{r.onHand}</td>
              <td>{r.reserved}</td>
              <td>{r.available}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Recent stock movements</h2>
      <table>
        <thead><tr><th>When</th><th>Type</th><th>SKU</th><th>Bin</th><th>Change</th><th>Note</th></tr></thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m.id}>
              <td>{fmtDate(m.createdAt)}</td><td>{m.type}</td><td>{m.product.sku}</td>
              <td>{m.location.code}</td><td>{m.delta > 0 ? `+${m.delta}` : m.delta}</td><td className="muted">{m.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
