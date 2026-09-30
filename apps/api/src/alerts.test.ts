import test from "node:test";
import assert from "node:assert/strict";
import { orderAlerts } from "./alerts.js";
import { suggestCourier } from "./courier.js";

const hours = (h: number) => h * 3_600_000;
const now = new Date("2026-01-15T10:00:00");

const base = {
  status: "PICKING",
  dueAt: new Date(now.getTime() + hours(10)),
  statusUpdatedAt: new Date(now.getTime() - hours(1)),
};

test("healthy order has no alerts", () => {
  assert.deepEqual(orderAlerts(base, now), []);
});

test("flags an overdue order", () => {
  const a = orderAlerts({ ...base, dueAt: new Date(now.getTime() - hours(1)) }, now);
  assert.equal(a[0].code, "OVERDUE");
  assert.equal(a[0].severity, "high");
});

test("flags an order due within two hours", () => {
  const a = orderAlerts({ ...base, dueAt: new Date(now.getTime() + hours(1)) }, now);
  assert.equal(a[0].code, "DUE_SOON");
});

test("flags a stalled order", () => {
  const a = orderAlerts({ ...base, statusUpdatedAt: new Date(now.getTime() - hours(5)) }, now);
  assert.ok(a.some((x) => x.code === "STALLED"));
});

test("flags a staged order after the courier pickup time", () => {
  const a = orderAlerts(
    { ...base, status: "STAGED", courier: { pickupTime: "09:00" } },
    now,
  );
  assert.ok(a.some((x) => x.code === "PICKUP_MISSED"));
});

test("finished orders never alert", () => {
  assert.deepEqual(orderAlerts({ ...base, status: "SHIPPED", dueAt: new Date(0) }, now), []);
});

const couriers = [
  { id: "1", code: "FAST", name: "Fast", cost: 9, speedDays: 1, pickupTime: "18:00" },
  { id: "2", code: "STD", name: "Std", cost: 5, speedDays: 3, pickupTime: "17:00" },
  { id: "3", code: "ECO", name: "Eco", cost: 3, speedDays: 6, pickupTime: "08:00" },
];

test("priority orders get the fastest courier still picking up today", () => {
  assert.equal(suggestCourier("PRIORITY", couriers, now)?.courier.code, "FAST");
});

test("standard orders get the cheapest courier still picking up today", () => {
  // ECO picks up at 08:00, which has already passed at 10:00
  assert.equal(suggestCourier("STANDARD", couriers, now)?.courier.code, "STD");
});
