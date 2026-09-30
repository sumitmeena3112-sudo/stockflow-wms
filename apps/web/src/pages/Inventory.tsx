import { FormEvent, useEffect, useState } from "react";
import { api, getUser } from "../api";

export default function Inventory() {
  const [rows, setRows] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [newLocation, setNewLocation] = useState("");
  const [error, setError] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = async () => {
    const [inv, p, l] = await Promise.all([api("/inventory"), api("/products"), api("/locations")]);
    setRows(inv);
    setProducts(p);
    setLocations(l);
  };
  useEffect(() => {
    load();
  }, []);

  async function receive(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/inventory/receive", "POST", { productId, locationId, quantity: Number(quantity) });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function addLocation(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/locations", "POST", { code: newLocation });
      setNewLocation("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Inventory</h1>
      {isAdmin && (
        <>
          <form className="card row" onSubmit={receive}>
            <strong>Receive stock</strong>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Product…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku}</option>)}
            </select>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Bin…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}
            </select>
            <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            <button type="submit" disabled={!productId || !locationId}>Receive</button>
          </form>
          <form className="card row" onSubmit={addLocation}>
            <strong>New bin</strong>
            <input placeholder="e.g. C-03-01" value={newLocation} onChange={(e) => setNewLocation(e.target.value)} />
            <button type="submit">Add bin</button>
          </form>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr><th>SKU</th><th>Product</th><th>Bin</th><th>On hand</th><th>Reserved</th><th>Available</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.product.sku}</td>
              <td>{r.product.name}</td>
              <td>{r.location.code}</td>
              <td>{r.onHand}</td>
              <td>{r.reserved}</td>
              <td>{r.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
