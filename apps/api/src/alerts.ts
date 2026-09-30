import { pickupStillToday } from "./courier.js";

export interface Alert {
  code: "OVERDUE" | "DUE_SOON" | "STALLED" | "PICKUP_MISSED";
  label: string;
  severity: "high" | "medium";
}

interface AlertInput {
  status: string;
  dueAt: Date;
  statusUpdatedAt: Date;
  courier?: { pickupTime: string } | null;
}

/** Hours an order may sit in a status before we call it stalled. */
export const STALL_HOURS: Record<string, number> = {
  RECEIVED: 4,
  PROCESSED: 3,
  PICKING: 3,
  PACKING: 2,
  STAGED: 6,
};

export const DUE_SOON_HOURS = 2;

export function formatDuration(ms: number): string {
  const minutes = Math.max(Math.round(ms / 60_000), 0);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Everything about an order that needs someone's attention right now. */
export function orderAlerts(order: AlertInput, now = new Date()): Alert[] {
  if (order.status === "SHIPPED" || order.status === "CANCELLED") return [];
  const alerts: Alert[] = [];

  const untilDue = order.dueAt.getTime() - now.getTime();
  if (untilDue < 0) {
    alerts.push({ code: "OVERDUE", label: `Overdue by ${formatDuration(-untilDue)}`, severity: "high" });
  } else if (untilDue <= DUE_SOON_HOURS * 3_600_000) {
    alerts.push({ code: "DUE_SOON", label: `Due in ${formatDuration(untilDue)}`, severity: "medium" });
  }

  const limit = STALL_HOURS[order.status];
  const idle = now.getTime() - order.statusUpdatedAt.getTime();
  if (limit !== undefined && idle > limit * 3_600_000) {
    alerts.push({
      code: "STALLED",
      label: `No progress for ${formatDuration(idle)}`,
      severity: "medium",
    });
  }

  if (order.status === "STAGED" && order.courier && !pickupStillToday(order.courier.pickupTime, now)) {
    alerts.push({
      code: "PICKUP_MISSED",
      label: "Courier pickup time has passed",
      severity: "high",
    });
  }

  return alerts;
}
