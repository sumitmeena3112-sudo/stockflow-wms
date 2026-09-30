export interface CourierLite {
  id: string;
  code: string;
  name: string;
  cost: number;
  speedDays: number;
  pickupTime: string; // "HH:MM"
}

/** Is today's pickup for this courier still ahead of us? */
export function pickupStillToday(pickupTime: string, now = new Date()): boolean {
  const [h, m] = pickupTime.split(":").map(Number);
  const pickup = new Date(now);
  pickup.setHours(h, m, 0, 0);
  return pickup.getTime() > now.getTime();
}

/**
 * Suggest a courier for an order.
 * Priority orders get the fastest courier whose pickup is still to come today;
 * standard orders get the cheapest. If every pickup has already gone, fall
 * back to the whole list so there is always an answer.
 */
export function suggestCourier<T extends CourierLite>(
  priority: string,
  couriers: T[],
  now = new Date(),
): { courier: T; reason: string } | null {
  if (couriers.length === 0) return null;

  const today = couriers.filter((c) => pickupStillToday(c.pickupTime, now));
  const pool = today.length > 0 ? today : couriers;
  const note = today.length > 0 ? "pickup still today" : "today's pickups have all passed";

  if (priority === "PRIORITY") {
    const [best] = [...pool].sort((a, b) => a.speedDays - b.speedDays || a.cost - b.cost);
    return { courier: best, reason: `Priority order: fastest courier (${note})` };
  }
  const [best] = [...pool].sort((a, b) => a.cost - b.cost || a.speedDays - b.speedDays);
  return { courier: best, reason: `Standard order: cheapest courier (${note})` };
}
