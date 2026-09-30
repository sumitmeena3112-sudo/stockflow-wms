import { Link } from "react-router-dom";

export const STEPS = ["RECEIVED", "PROCESSED", "PICKING", "PACKING", "STAGED", "SHIPPED"];

export const STEP_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  PROCESSED: "Processed",
  PICKING: "Picking",
  PACKING: "Packing",
  STAGED: "Staged",
  SHIPPED: "Shipped",
  CANCELLED: "Cancelled",
};

export const ISSUE_TYPES: Record<string, string> = {
  STOCK_SHORT: "Stock short",
  WRONG_ITEM: "Wrong item",
  DAMAGED: "Damaged",
  MISSING_ITEM: "Item missing",
  MISSED_PICKUP: "Missed pickup",
  DELIVERY: "Delivery problem",
  OTHER: "Other",
};

export const money = (n: number) => `$${n.toFixed(2)}`;

export const fmtDate = (d: string) =>
  new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** "in 3h" / "2h ago" style text for a deadline. */
export function dueText(d: string) {
  const ms = new Date(d).getTime() - Date.now();
  const mins = Math.round(Math.abs(ms) / 60000);
  const text = mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
  return ms < 0 ? `${text} overdue` : `in ${text}`;
}

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`badge ${status}`}>{STEP_LABEL[status] ?? status}</span>
);

export const PriorityBadge = ({ priority }: { priority: string }) =>
  priority === "PRIORITY" ? <span className="badge PRIORITY">Priority</span> : null;

export const AlertChips = ({ alerts }: { alerts: { code: string; label: string; severity: string }[] }) => (
  <>
    {alerts.map((a) => (
      <span key={a.code} className={`chip ${a.severity}`} title={a.label}>
        {a.label}
      </span>
    ))}
  </>
);

/** A compact table of orders, used on the warehouse screen. */
export function OrderTable({ orders, empty }: { orders: any[]; empty: string }) {
  if (orders.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table>
      <thead>
        <tr><th>Order</th><th>Customer</th><th>Items</th><th>Due</th><th>Status</th><th>Alerts</th></tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td><Link to={`/orders/${o.id}`}>{o.reference}</Link> <PriorityBadge priority={o.priority} /></td>
            <td>{o.customer}</td>
            <td>{o.lines.reduce((s: number, l: any) => s + l.quantity, 0)}</td>
            <td>{dueText(o.dueAt)}</td>
            <td><StatusBadge status={o.status} /></td>
            <td><AlertChips alerts={o.alerts} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const ProductName = ({ p }: { p: any }) => (
  <>
    {p.name}
    {p.variant && <span className="muted"> · {p.variant}</span>}
  </>
);
