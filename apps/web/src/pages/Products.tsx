import { FormEvent, useEffect, useState } from "react";
import { api, getUser } from "../api";

export default function Products() {
  const [items, setItems] = useState<any[]>([]);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("");
  const [error, setError] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = () => api("/products").then(setItems);
  useEffect(() => {
    load();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/products", "POST", { sku, name, variant });
      setSku("");
      setName("");
      setVariant("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Products</h1>
      <p className="muted">Every size and colour has its own SKU, so pickers and packers can confirm the exact variant.</p>
      {isAdmin && (
        <form className="card row" onSubmit={add}>
          <input placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Variant (e.g. Black / M)" value={variant} onChange={(e) => setVariant(e.target.value)} />
          <button type="submit" disabled={!sku || !name}>Add product</button>
          {error && <span className="error">{error}</span>}
        </form>
      )}
      <table>
        <thead><tr><th>SKU</th><th>Name</th><th>Variant</th></tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id}><td>{p.sku}</td><td>{p.name}</td><td>{p.variant ?? ""}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
