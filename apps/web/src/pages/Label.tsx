import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";

export default function Label() {
  const { id } = useParams();
  const [o, setO] = useState<any>(null);
  useEffect(() => {
    api(`/orders/${id}`).then(setO);
  }, [id]);
  if (!o) return <p>Loading…</p>;
  if (!o.trackingNumber) return <p>This order has no label yet. Process it first.</p>;

  // simple barcode-like stripe from the tracking number (visual only)
  const bars = o.trackingNumber.split("").map((c: string) => (c.charCodeAt(0) % 4) + 1);

  return (
    <>
      <div className="row noprint">
        <Link to={`/orders/${o.id}`}>← Back to order</Link>
        <span className="spacer" />
        <button onClick={() => window.print()}>Print label</button>
      </div>
      <div className="label">
        <div className="label-head">
          <strong>{o.courier?.name}</strong>
          <span>{o.priority === "PRIORITY" ? "PRIORITY" : "STANDARD"}</span>
        </div>
        <div className="label-block">
          <small>SHIP TO</small>
          <div className="label-big">{o.customer}</div>
          <div>{o.address || "No address provided"}</div>
        </div>
        <div className="label-block">
          <small>ORDER</small>
          <div>{o.reference} · {o.channel}</div>
          <small>CONTENTS</small>
          {o.lines.map((l: any) => (
            <div key={l.id}>{l.quantity} × {l.product.sku} {l.product.variant ? `(${l.product.variant})` : ""}</div>
          ))}
        </div>
        <div className="label-block">
          <div className="bars">
            {bars.map((w: number, i: number) => (
              <span key={i} style={{ width: w * 2 }} />
            ))}
          </div>
          <div className="label-big mono">{o.trackingNumber}</div>
        </div>
      </div>
    </>
  );
}
