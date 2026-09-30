import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, getUser } from "../api";
import {
  AlertChips,
  ISSUE_TYPES,
  PriorityBadge,
  ProductName,
  STEPS,
  STEP_LABEL,
  StatusBadge,
  dueText,
  fmtDate,
  money,
} from "../ui";

export default function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [couriers, setCouriers] = useState<any[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [courierId, setCourierId] = useState("");
  const [scan, setScan] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [issueType, setIssueType] = useState("DAMAGED");
  const [issueText, setIssueText] = useState("");
  const isAdmin = getUser()?.role === "ADMIN";

  const load = () =>
    api(`/orders/${id}`).then((o) => {
      setOrder(o);
      setCourierId((cur) => cur || o.suggestedCourier?.courier.id || "");
    });
  useEffect(() => {
    load();
    api("/couriers").then(setCouriers);
    api("/locations").then((ls: any[]) => setLocations(Object.fromEntries(ls.map((l) => [l.id, l.code]))));
  }, [id]);

  async function act(path: string, body?: unknown) {
    setError("");
    try {
      setOrder(await api(`/orders/${id}${path}`, "POST", body));
    } catch (err: any) {
      setError(err.message);
      load(); // a wrong scan is logged, so refresh the timeline
    }
  }

  async function transfer(allocationId: string) {
    setError("");
    try {
      setOrder(await api(`/allocations/${allocationId}/transfer`, "POST"));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function report(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/issues", "POST", { orderId: id, type: issueType, description: issueText });
      setIssueText("");
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!order) return <p>Loading…</p>;
  const s = order.status;
  const stepIndex = STEPS.indexOf(s);
  const allPacked = order.lines.every((l: any) => l.packed);
  const pickable = s === "PROCESSED" || s === "PICKING";

  // a plain function (not a component) so the input keeps focus while typing
  const scanBox = (k: string, label: string, onGo: (sku: string) => void) => (
    <span className="scan">
      <input
        placeholder="Scan / type SKU"
        value={scan[k] ?? ""}
        onChange={(e) => setScan({ ...scan, [k]: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && scan[k] && onGo(scan[k])}
      />
      <button disabled={!scan[k]} onClick={() => onGo(scan[k])}>{label}</button>
    </span>
  );

  return (
    <>
      <p><Link to="/orders">← Orders</Link></p>
      <div className="row">
        <h1 style={{ margin: 0 }}>{order.reference}</h1>
        <StatusBadge status={s} />
        <PriorityBadge priority={order.priority} />
        <AlertChips alerts={order.alerts} />
      </div>
      <p className="muted">
        {order.customer} · {order.channel}
        {order.address && ` · ${order.address}`}
        {!["SHIPPED", "CANCELLED"].includes(s) && ` · ship by ${fmtDate(order.dueAt)} (${dueText(order.dueAt)})`}
      </p>

      {s !== "CANCELLED" && (
        <div className="stepper">
          {STEPS.map((st, i) => (
            <div key={st} className={`step ${i < stepIndex ? "done" : i === stepIndex ? "current" : ""}`}>
              <span>{i + 1}</span>
              {STEP_LABEL[st]}
            </div>
          ))}
        </div>
      )}

      {error && <p className="error banner">{error}</p>}

      {/* 2. Process */}
      {s === "RECEIVED" && isAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Process this order</h2>
          <p className="muted small">
            Choose a courier. Processing creates the shipping label and reserves the stock.
            {order.suggestedCourier && <> Suggested: <b>{order.suggestedCourier.courier.name}</b> – {order.suggestedCourier.reason}.</>}
          </p>
          <div className="row">
            <select value={courierId} onChange={(e) => setCourierId(e.target.value)}>
              <option value="">Courier…</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} – {money(c.cost)} – {c.speedDays} day{c.speedDays === 1 ? "" : "s"} – pickup {c.pickupTime}
                </option>
              ))}
            </select>
            <button className="big" disabled={!courierId} onClick={() => act("/process", { courierId })}>
              Process and create label
            </button>
          </div>
        </div>
      )}
      {s === "RECEIVED" && !isAdmin && <p className="muted">Waiting for the office to process this order.</p>}

      {/* Courier and label */}
      {order.trackingNumber && (
        <div className="card row">
          <span><b>Courier:</b> {order.courier?.name}</span>
          <span><b>Tracking:</b> {order.trackingNumber}</span>
          {order.stagingSlot && <span><b>Staging lane:</b> {order.stagingSlot}</span>}
          <span className="spacer" />
          <Link to={`/orders/${order.id}/label`} className="linkbtn">Print shipping label</Link>
        </div>
      )}

      {/* 3. Pick, 4. Pack */}
      {s !== "RECEIVED" && s !== "CANCELLED" && (
        <>
          <h2>{pickable ? "Pick list" : "Items"}</h2>
          <table>
            <thead>
              <tr><th>SKU</th><th>Product</th><th>Qty</th><th>Bin</th><th></th></tr>
            </thead>
            <tbody>
              {order.lines.flatMap((line: any) =>
                line.allocations.map((a: any) => (
                  <tr key={a.id}>
                    <td><b>{line.product.sku}</b></td>
                    <td><ProductName p={line.product} /></td>
                    <td>{a.quantity}</td>
                    <td>
                      {a.stockLevel.location.code}{" "}
                      {!a.stockLevel.location.warehouse.isMain && <span className="chip medium">overflow</span>}
                    </td>
                    <td>
                      {a.picked ? (
                        "✓ picked"
                      ) : a.needsTransfer && pickable ? (
                        <button className="ghost" onClick={() => transfer(a.id)}>
                          Move to {locations[a.transferToLocationId] ?? "main"} first
                        </button>
                      ) : pickable ? (
                        scanBox(a.id, "Pick", (sku) => act(`/allocations/${a.id}/pick`, { sku }))
                      ) : null}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      )}

      {s === "PACKING" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pack the box</h2>
          <p className="muted small">Scan each item again as it goes into the box, then attach the printed label.</p>
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Qty</th><th></th></tr></thead>
            <tbody>
              {order.lines.map((l: any) => (
                <tr key={l.id}>
                  <td><b>{l.product.sku}</b></td>
                  <td><ProductName p={l.product} /></td>
                  <td>{l.quantity}</td>
                  <td>
                    {l.packed ? "✓ in box" : (
                      scanBox(l.id, "Verify", (sku) => act(`/lines/${l.id}/pack`, { sku }))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="big" disabled={!allPacked} onClick={() => act("/stage")}>
              Label attached, move box to staging
            </button>
          </div>
        </div>
      )}

      {/* 5/6. Staging and shipping */}
      {s === "STAGED" && (
        <div className="card row">
          <span>Box is in <b>{order.stagingSlot}</b> waiting for {order.courier?.name} (pickup {order.courier?.pickupTime}).</span>
          <span className="spacer" />
          <button className="big" onClick={() => act("/ship")}>Courier collected it: mark shipped</button>
        </div>
      )}

      {s === "SHIPPED" && <p className="ok">Shipped {order.shippedAt && fmtDate(order.shippedAt)}.</p>}

      {isAdmin && !["SHIPPED", "CANCELLED"].includes(s) && (
        <div className="row">
          <button
            className="danger"
            onClick={() => {
              const reason = window.prompt("Reason for cancelling (optional)") ?? null;
              if (reason !== null) act("/cancel", { reason });
            }}
          >
            Cancel order
          </button>
        </div>
      )}

      {/* Problems */}
      <h2>Problems</h2>
      {order.issues.length > 0 && (
        <table>
          <thead><tr><th>Type</th><th>What happened</th><th>Status</th></tr></thead>
          <tbody>
            {order.issues.map((i: any) => (
              <tr key={i.id}>
                <td>{ISSUE_TYPES[i.type] ?? i.type}</td>
                <td>{i.description}{i.resolutionNote && <div className="muted small">Resolved: {i.resolutionNote}</div>}</td>
                <td><span className={`badge ${i.status === "OPEN" ? "CANCELLED" : "SHIPPED"}`}>{i.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="row" onSubmit={report}>
        <select value={issueType} onChange={(e) => setIssueType(e.target.value)}>
          {Object.entries(ISSUE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="wide" placeholder="Describe the problem" value={issueText} onChange={(e) => setIssueText(e.target.value)} />
        <button type="submit" className="ghost" disabled={issueText.trim().length < 3}>Report problem</button>
      </form>

      {/* History */}
      <h2>History</h2>
      <ul className="timeline">
        {order.events.map((e: any) => (
          <li key={e.id}>
            <span className="muted small">{fmtDate(e.createdAt)} · {e.actor}</span>
            <div>{e.message}</div>
          </li>
        ))}
      </ul>
    </>
  );
}
