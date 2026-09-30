import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { allocateWithOverflow } from "../src/allocate.js";

const prisma = new PrismaClient();
const HOUR = 3_600_000;
const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * HOUR);
const hoursAhead = (h: number) => new Date(now + h * HOUR);

const users = [
  { email: "admin@stockflow.local", name: "Demo Admin (office)", password: "Admin@12345", role: "ADMIN" },
  { email: "picker@stockflow.local", name: "Demo Picker (warehouse)", password: "Picker@12345", role: "PICKER" },
];

const warehouses = [
  { code: "MAIN", name: "Main Warehouse", isMain: true },
  { code: "OVF", name: "Overflow Warehouse", isMain: false },
];

const locations: [string, string][] = [
  ["A-01-01", "MAIN"], ["A-01-02", "MAIN"], ["A-02-01", "MAIN"], ["B-01-01", "MAIN"],
  ["B-02-01", "MAIN"], ["B-02-02", "MAIN"], ["C-01-01", "MAIN"], ["C-03-01", "MAIN"],
  ["OVF-01", "OVF"], ["OVF-02", "OVF"], ["OVF-03", "OVF"],
];

const couriers = [
  { code: "FSX", name: "FastShip Express", cost: 9.5, speedDays: 1, pickupTime: "18:00" },
  { code: "QPS", name: "QuickPost Standard", cost: 5.2, speedDays: 3, pickupTime: "17:00" },
  { code: "ECO", name: "EcoMail Economy", cost: 3.1, speedDays: 6, pickupTime: "15:30" },
];

const products = [
  { sku: "TEE-BLK-M", name: "T-Shirt", variant: "Black / M" },
  { sku: "TEE-BLK-L", name: "T-Shirt", variant: "Black / L" },
  { sku: "TEE-WHT-M", name: "T-Shirt", variant: "White / M" },
  { sku: "TEE-WHT-L", name: "T-Shirt", variant: "White / L" },
  { sku: "HOOD-GRY-M", name: "Hoodie", variant: "Grey / M" },
  { sku: "HOOD-GRY-L", name: "Hoodie", variant: "Grey / L" },
  { sku: "CAP-NVY", name: "Cap", variant: "Navy" },
  { sku: "MUG-WHT", name: "Ceramic Mug", variant: "White" },
  { sku: "BTL-STL-750", name: "Steel Water Bottle", variant: "750 ml" },
  { sku: "BAG-TOTE", name: "Canvas Tote Bag", variant: "Natural" },
  { sku: "NOTE-A5", name: "Notebook", variant: "A5" },
  { sku: "PEN-BLU-10", name: "Pens", variant: "Blue, 10 pack" },
  { sku: "STK-LOGO", name: "Logo Stickers", variant: "Sheet" },
];

// [sku, bin, quantity]. Some stock lives in the overflow warehouse.
const stock: [string, string, number][] = [
  ["TEE-BLK-M", "A-01-01", 40], ["TEE-BLK-M", "OVF-01", 60],
  ["TEE-BLK-L", "A-01-01", 35],
  ["TEE-WHT-M", "A-01-02", 28],
  ["TEE-WHT-L", "A-01-02", 32],
  ["HOOD-GRY-M", "A-02-01", 14],
  ["HOOD-GRY-L", "A-02-01", 18], ["HOOD-GRY-L", "OVF-02", 40],
  ["CAP-NVY", "A-02-01", 8],
  ["MUG-WHT", "B-02-01", 12], ["MUG-WHT", "OVF-02", 90],
  ["BTL-STL-750", "B-01-01", 45],
  ["BAG-TOTE", "C-01-01", 70], ["BAG-TOTE", "OVF-03", 100],
  ["NOTE-A5", "C-01-01", 120], ["NOTE-A5", "C-03-01", 50],
  ["PEN-BLU-10", "C-03-01", 4],
  ["STK-LOGO", "C-03-01", 200],
];

const RANK = ["RECEIVED", "PROCESSED", "PICKING", "PACKING", "STAGED", "SHIPPED"];

interface SeedOrder {
  ref: string;
  customer: string;
  channel: string;
  priority: "PRIORITY" | "STANDARD";
  dueH: number; // hours from now (negative = already overdue)
  status: string;
  lines: [string, number][];
  courier?: string;
  ageH?: number; // hours spent in the current status
  createdH?: number;
  packedLines?: number;
}

/** Create an order and put it in `status`, with stock levels consistent with that state. */
async function makeOrder(o: SeedOrder) {
  const rank = RANK.indexOf(o.status); // -1 for CANCELLED
  const created = hoursAgo(o.createdH ?? 6);
  const updated = hoursAgo(o.ageH ?? 1);
  const courier = o.courier ? await prisma.courier.findUniqueOrThrow({ where: { code: o.courier } }) : null;
  const processed = rank >= 1 && courier;

  const order = await prisma.order.create({
    data: {
      reference: o.ref,
      customer: o.customer,
      channel: o.channel,
      address: `${10 + (o.ref.length * 7) % 80} Market Street, Springfield`,
      priority: o.priority,
      dueAt: hoursAhead(o.dueH),
      status: o.status,
      statusUpdatedAt: updated,
      createdAt: created,
      courierId: processed ? courier!.id : null,
      trackingNumber: processed ? `${courier!.code}-${o.ref.replace("SO-", "")}${o.ref.length}X` : null,
      stagingSlot: o.status === "STAGED" ? `LANE-${courier!.code}` : null,
      shippedAt: o.status === "SHIPPED" ? updated : null,
    },
  });

  const events: [Date, string][] = [[created, `Order received from ${o.channel}`]];
  const mid = (i: number) => new Date(created.getTime() + ((updated.getTime() - created.getTime()) * i) / 5);
  if (rank >= 1) events.push([mid(1), `Processed: ${courier?.name}, label created, stock reserved`]);
  if (rank >= 2) events.push([mid(2), "Picking started"]);
  if (rank >= 3) events.push([mid(3), "All items picked, ready to pack"]);
  if (rank >= 4) events.push([mid(4), `Box labelled and staged in LANE-${courier?.code}`]);
  if (rank >= 5) events.push([updated, `Collected by ${courier?.name} - shipped`]);
  if (o.status === "CANCELLED") events.push([updated, "Cancelled: customer request. Reserved stock released."]);
  for (const [createdAt, message] of events) {
    await prisma.orderEvent.create({ data: { orderId: order.id, message, createdAt, actor: "Demo data" } });
  }

  let firstAllocation = true;
  let lineIndex = 0;
  for (const [sku, quantity] of o.lines) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
    const packed = rank >= 4 || (o.status === "PACKING" && lineIndex < (o.packedLines ?? 0));
    lineIndex++;
    const line = await prisma.orderLine.create({
      data: { orderId: order.id, productId: product.id, quantity, packed },
    });
    if (rank < 1) continue;

    const levels = await prisma.stockLevel.findMany({
      where: { productId: product.id },
      include: { location: { include: { warehouse: true } } },
    });
    const bin = (l: (typeof levels)[number]) => ({ id: l.id, available: l.onHand - l.reserved });
    const plan = allocateWithOverflow(
      levels.filter((l) => l.location.warehouse.isMain).map(bin),
      levels.filter((l) => !l.location.warehouse.isMain).map(bin),
      quantity,
    );
    if (!plan) throw new Error(`Seed: not enough stock for ${sku}`);
    const destination = levels.find((l) => l.location.warehouse.isMain)?.locationId ?? null;

    for (const p of plan) {
      if (p.overflow && rank > 1) throw new Error("Seed: only PROCESSED orders may use overflow stock");
      const picked = rank >= 3 || (o.status === "PICKING" && firstAllocation);
      if (!p.overflow) firstAllocation = false;
      const level = levels.find((l) => l.id === p.binId)!;

      await prisma.allocation.create({
        data: {
          orderLineId: line.id,
          stockLevelId: p.binId,
          quantity: p.quantity,
          picked,
          needsTransfer: p.overflow,
          transferToLocationId: p.overflow ? destination : null,
        },
      });
      if (picked) {
        await prisma.orderLine.update({ where: { id: line.id }, data: { picked: { increment: p.quantity } } });
      }
      if (o.status === "SHIPPED") {
        await prisma.stockLevel.update({ where: { id: p.binId }, data: { onHand: { decrement: p.quantity } } });
        await prisma.stockMovement.create({
          data: {
            productId: product.id,
            locationId: level.locationId,
            delta: -p.quantity,
            type: "OUTBOUND",
            note: `Shipped ${o.ref}`,
            createdAt: updated,
          },
        });
      } else {
        await prisma.stockLevel.update({ where: { id: p.binId }, data: { reserved: { increment: p.quantity } } });
      }
    }
  }
}

// Small deterministic generator so the demo data is the same every time.
let seedState = 42;
const rand = () => {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
};
const pickOne = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

async function main() {
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) },
    });
  }
  for (const w of warehouses) await prisma.warehouse.upsert({ where: { code: w.code }, update: {}, create: w });
  for (const [code, wh] of locations) {
    const warehouse = await prisma.warehouse.findUniqueOrThrow({ where: { code: wh } });
    await prisma.location.upsert({ where: { code }, update: {}, create: { code, warehouseId: warehouse.id } });
  }
  for (const c of couriers) await prisma.courier.upsert({ where: { code: c.code }, update: {}, create: c });
  for (const p of products) await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p });

  // Sample stock, orders and deliveries are only created on a fresh database.
  if ((await prisma.order.count()) > 0) {
    console.log("Orders already exist, skipping demo stock and orders.");
    return;
  }

  for (const [sku, code, qty] of stock) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
    const location = await prisma.location.findUniqueOrThrow({ where: { code } });
    await prisma.stockLevel.upsert({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
      update: {},
      create: { productId: product.id, locationId: location.id, onHand: qty },
    });
    await prisma.stockMovement.create({
      data: { productId: product.id, locationId: location.id, delta: qty, type: "INBOUND", note: "Opening stock", createdAt: hoursAgo(240) },
    });
  }

  // Hand-made orders covering every stage and every kind of alert.
  await makeOrder({ ref: "SO-00001", customer: "Aarav Traders", channel: "Shopee", priority: "STANDARD", dueH: -40, status: "SHIPPED", courier: "QPS", lines: [["TEE-BLK-M", 12], ["MUG-WHT", 10]], ageH: 50, createdH: 72 });
  await makeOrder({ ref: "SO-00002", customer: "Bright Cafe", channel: "Website", priority: "STANDARD", dueH: -20, status: "SHIPPED", courier: "ECO", lines: [["BAG-TOTE", 20]], ageH: 30, createdH: 60 });
  await makeOrder({ ref: "SO-00003", customer: "Kiran Sports Club", channel: "Amazon", priority: "PRIORITY", dueH: 3, status: "STAGED", courier: "FSX", lines: [["HOOD-GRY-L", 10], ["CAP-NVY", 4]], ageH: 1, createdH: 8 });
  await makeOrder({ ref: "SO-00004", customer: "Nisha Boutique", channel: "Shopee", priority: "STANDARD", dueH: 20, status: "STAGED", courier: "QPS", lines: [["TEE-WHT-M", 6]], ageH: 2, createdH: 9 });
  await makeOrder({ ref: "SO-00005", customer: "Campus Store", channel: "Website", priority: "PRIORITY", dueH: 1.5, status: "PACKING", courier: "FSX", lines: [["NOTE-A5", 30], ["BTL-STL-750", 5]], packedLines: 1, ageH: 0.5, createdH: 5 });
  await makeOrder({ ref: "SO-00006", customer: "Riya Gifts", channel: "Shopee", priority: "PRIORITY", dueH: -1, status: "PICKING", courier: "FSX", lines: [["TEE-BLK-M", 20], ["STK-LOGO", 40]], ageH: 5, createdH: 10 });
  await makeOrder({ ref: "SO-00007", customer: "Metro Office Supplies", channel: "Website", priority: "STANDARD", dueH: 8, status: "PROCESSED", courier: "QPS", lines: [["MUG-WHT", 25], ["BAG-TOTE", 10]], ageH: 0.5, createdH: 3 });
  await makeOrder({ ref: "SO-00008", customer: "HomeStyle", channel: "Amazon", priority: "PRIORITY", dueH: 4, status: "PROCESSED", courier: "FSX", lines: [["TEE-BLK-L", 10]], ageH: 0.3, createdH: 2 });
  await makeOrder({ ref: "SO-00009", customer: "Sunrise Stationers", channel: "Website", priority: "STANDARD", dueH: 30, status: "CANCELLED", lines: [["PEN-BLU-10", 3]], ageH: 4, createdH: 20 });
  // More pens are ordered than exist. Processing it will log a stock problem.
  await makeOrder({ ref: "SO-00010", customer: "Lakeside School", channel: "Website", priority: "STANDARD", dueH: 12, status: "RECEIVED", lines: [["PEN-BLU-10", 20]], ageH: 6, createdH: 6 });

  // A realistic morning queue of fresh orders, some stuck and some urgent.
  const channels = ["Shopee", "Amazon", "Website", "Shopee", "Website"];
  const names = ["Dev Patel", "Meera Shah", "Sam Lopez", "Ananya Rao", "Tom Becker", "Zoya Khan", "Leo Martin", "Isha Nair", "Omar Ali", "Priya Das", "Noah Kim", "Fatima Noor", "Raj Malhotra", "Emma Clark"];
  const stockable = products.map((p) => p.sku).filter((s) => !["PEN-BLU-10", "CAP-NVY"].includes(s));
  for (let i = 0; i < 28; i++) {
    const nLines = 1 + Math.floor(rand() * 2);
    const used = new Set<string>();
    const lines: [string, number][] = [];
    while (lines.length < nLines) {
      const sku = pickOne(stockable);
      if (used.has(sku)) continue;
      used.add(sku);
      lines.push([sku, 1 + Math.floor(rand() * 3)]);
    }
    const priority = rand() < 0.25 ? "PRIORITY" : "STANDARD";
    await makeOrder({
      ref: `SO-${String(11 + i).padStart(5, "0")}`,
      customer: pickOne(names),
      channel: pickOne(channels),
      priority,
      dueH: priority === "PRIORITY" ? -1 + rand() * 6 : 4 + rand() * 40,
      status: "RECEIVED",
      lines,
      ageH: rand() < 0.15 ? 5 + rand() * 3 : rand() * 3, // a few have been waiting too long
      createdH: 2 + rand() * 8,
    });
  }

  // Inbound deliveries at each stage.
  const tee = await prisma.product.findUniqueOrThrow({ where: { sku: "TEE-BLK-M" } });
  const mug = await prisma.product.findUniqueOrThrow({ where: { sku: "MUG-WHT" } });
  const note = await prisma.product.findUniqueOrThrow({ where: { sku: "NOTE-A5" } });
  const pen = await prisma.product.findUniqueOrThrow({ where: { sku: "PEN-BLU-10" } });
  const a0101 = await prisma.location.findUniqueOrThrow({ where: { code: "A-01-01" } });

  await prisma.delivery.create({
    data: {
      reference: "IN-0001", supplier: "Threadworks Apparel", status: "PUT_AWAY", expectedAt: hoursAgo(120),
      lines: { create: [{ productId: tee.id, expectedQty: 40, receivedQty: 40, damagedQty: 0, locationId: a0101.id }] },
    },
  });
  await prisma.delivery.create({
    data: {
      reference: "IN-0002", supplier: "Ceramic Co", status: "CHECKED", expectedAt: hoursAgo(3),
      lines: { create: [{ productId: mug.id, expectedQty: 60, receivedQty: 58, damagedQty: 2 }] },
    },
  });
  await prisma.delivery.create({
    data: {
      reference: "IN-0003", supplier: "PaperTrail Ltd", status: "EXPECTED", expectedAt: hoursAhead(20),
      lines: { create: [{ productId: note.id, expectedQty: 100 }, { productId: pen.id, expectedQty: 50 }] },
    },
  });

  // Problems are logged, not handled informally.
  const so6 = await prisma.order.findUniqueOrThrow({ where: { reference: "SO-00006" } });
  const so1 = await prisma.order.findUniqueOrThrow({ where: { reference: "SO-00001" } });
  await prisma.issue.create({
    data: { type: "DELIVERY", description: "IN-0002 from Ceramic Co: MUG-WHT: expected 60, received 58; MUG-WHT: 2 damaged", reportedBy: "Demo Picker (warehouse)", createdAt: hoursAgo(3) },
  });
  await prisma.issue.create({
    data: { orderId: so6.id, type: "MISSING_ITEM", description: "Sticker sheets not in bin C-03-01 shelf, checking the back stock", reportedBy: "Demo Picker (warehouse)", createdAt: hoursAgo(2) },
  });
  await prisma.issue.create({
    data: {
      orderId: so1.id, type: "MISSED_PICKUP", description: "QuickPost did not arrive for pickup", reportedBy: "Demo Admin (office)",
      status: "RESOLVED", resolutionNote: "Rebooked for next morning, courier confirmed", createdAt: hoursAgo(60), resolvedAt: hoursAgo(52),
    },
  });

  console.log("Seeded demo data.");
}

main().finally(() => prisma.$disconnect());
