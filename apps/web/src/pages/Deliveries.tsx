import { useEffect, useState } from "react";
import { api, getUser } from "../api";
import { ProductName, fmtDate } from "../ui";

const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STEP_TEXT: Record<string, string> = {
  EXPECTED: "1. Expected: count what arrived",
  CHECKED: "2. Checked: put it on the shelves",
  PUT_AWAY: "3. On shelves: available to sell",
};

function DeliveryCard({ d, locations, reload }: { d: any; locations: any[]; reload: () => void }) {
  const [counts, setCounts] = useState<Record<string, { received: number; damaged: number }>>(
    Object.fromEntries(d.lines.map((l: any) => [l.id, { received: l.expectedQty, damaged: 0 }])),
  );
  const [bins, setBins] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function check() {
    setError("");
    try {
      const r = await api(`/deliveries/${d.id}/check`, "POST", {
        lines: d.lines.map((l: any) => ({ id: l.id, receivedQty: counts[l.id].received, damagedQty: counts[l.id].damaged })),
      });
      setNote(r.problems.length ? `Logged as an issue: ${r.problems.join("; ")}` : "Count matches. Now put it away.");
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function putAway() {
    setError("");
    try {
      await api(`/deliveries/${d.id}/putaway`, "POST", {
        lines: d.lines.map((l: any) => ({ id: l.id, locationId: bins[l.id] })),
      });
      reload();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <strong>{d.reference}</strong>
        <span>{d.supplier}</span>
        <span className="muted small">expected {fmtDate(d.expectedAt)}</span>
        <span className="spacer" />
        <span className={`badge ${d.status === "PUT_AWAY" ? "SHIPPED" : d.status === "CHECKED" ? "PACKING" : "PROCESSED"}`}>{STEP_TEXT[d.status]}</span>
      </div>
      <table>
        <thead>
          <tr><th>SKU</th><th>Product</th><th>Expected</th><th>Received</th><th>Damaged</th><th>{d.status === "CHECKED" ? "Shelve in bin" : "Bin"}</th></tr>
        </thead>
        <tbody>
          {d.lines.map((l: any) => {
            const good = l.receivedQty - l.damagedQty;
            return (
              <tr key={l.id}>
                <td>{l.product.sku}</td>
                <td><ProductName p={l.product} /></td>
                <td>{l.expectedQty}</td>
                <td>
                  {d.status === "EXPECTED" ? (
                    <input type="number" min={0} value={counts[l.id].received}
                      onChange={(e) => setCounts({ ...counts, [l.id]: { ...counts[l.id], received: Number(e.target.value) } })} />
                  ) : l.receivedQty}
                </td>
                <td>
                  {d.status === "EXPECTED" ? (
                    <input type="number" min={0} value={counts[l.id].damaged}
                      onChange={(e) => setCounts({ ...counts, [l.id]: { ...counts[l.id], damaged: Number(e.target.value) } })} />
                  ) : l.damagedQty}
                </td>
                <td>
                  {d.status === "CHECKED" && good > 0 ? (
                    <select value={bins[l.id] ?? ""} onChange={(e) => setBins({ ...bins, [l.id]: e.target.value })}>
                      <option value="">Bin for {good} unit(s)…</option>
                      {locations.map((b) => <option key={b.id} value={b.id}>{b.code} ({b.warehouse.code})</option>)}
                    </select>
                  ) : d.status === "PUT_AWAY" ? (locations.find((b) => b.id === l.locationId)?.code ?? "") : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="error">{error}</p>}
      {note && <p className="muted small">{note}</p>}
      {d.status === "EXPECTED" && <div className="row" style={{ marginTop: 10 }}><button className="big" onClick={check}>Confirm the count</button></div>}
      {d.status === "CHECKED" && <div className="row" style={{ marginTop: 10 }}><button className="big" onClick={putAway}>Put on shelves</button></div>}
    </div>
  );
}

export default function Deliveries() {
  const [list, setList] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [expected, setExpected] = useState(toLocalInput(new Date(Date.now() + 24 * 3600_000)));
  const [lines, setLines] = useState([{ productId: "", expectedQty: 10 }]);
  const [error, setError] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = () => api("/deliveries").then(setList);
  useEffect(() => {
    load();
    api("/locations").then(setLocations);
    api("/products").then(setProducts);
  }, []);

  async function create() {
    setError("");
    try {
      await api("/deliveries", "POST", {
        supplier,
        expectedAt: new Date(expected).toISOString(),
        lines: lines.filter((l) => l.productId),
      });
      setShow(false);
      setSupplier("");
      setLines([{ productId: "", expectedQty: 10 }]);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const setLine = (i: number, patch: object) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>Inbound deliveries</h1>
        <span className="spacer" />
        {isAdmin && <button onClick={() => setShow(!show)}>{show ? "Close" : "+ Expect a delivery"}</button>}
      </div>
      <p className="muted">Unload, count, note any damage, then shelve. Stock only becomes sellable once it is put away. Any difference is logged as an issue.</p>

      {show && (
        <div className="card">
          <div className="row">
            <input placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            <label className="inline">Expected <input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} /></label>
          </div>
          {lines.map((l, i) => (
            <div className="row" key={i}>
              <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                <option value="">Product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.sku} – {p.name}{p.variant ? ` (${p.variant})` : ""}</option>)}
              </select>
              <input type="number" min={1} value={l.expectedQty} onChange={(e) => setLine(i, { expectedQty: Number(e.target.value) })} />
            </div>
          ))}
          <div className="row">
            <button className="ghost" onClick={() => setLines([...lines, { productId: "", expectedQty: 10 }])}>+ Add line</button>
            <button disabled={!supplier || !lines.some((l) => l.productId)} onClick={create}>Save delivery</button>
            {error && <span className="error">{error}</span>}
          </div>
        </div>
      )}

      {list.map((d) => <DeliveryCard key={d.id + d.status} d={d} locations={locations} reload={load} />)}
    </>
  );
}
