import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { allocate } from "../src/allocate.js";

const prisma = new PrismaClient();

const users = [
  { email: "admin@stockflow.local", name: "Demo Admin", password: "Admin@12345", role: "ADMIN" },
  { email: "picker@stockflow.local", name: "Demo Picker", password: "Picker@12345", role: "PICKER" },
];

const locations = ["A-01-01", "A-01-02", "A-02-01", "B-01-01", "B-02-01", "B-02-02", "C-01-01", "C-03-01"];

const products = [
  { sku: "TEE-BLK-M", name: "Black T-Shirt (M)" },
  { sku: "TEE-WHT-L", name: "White T-Shirt (L)" },
  { sku: "HOOD-GRY-L", name: "Grey Hoodie (L)" },
  { sku: "CAP-NVY", name: "Navy Cap" },
  { sku: "MUG-WHT", name: "White Ceramic Mug" },
  { sku: "BTL-STL-750", name: "Steel Water Bottle 750ml" },
  { sku: "BAG-TOTE", name: "Canvas Tote Bag" },
  { sku: "NOTE-A5", name: "A5 Notebook" },
  { sku: "PEN-BLU-10", name: "Blue Pens (10 pack)" },
  { sku: "STK-LOGO", name: "Logo Sticker Sheet" },
];

// [sku, bin, quantity]
const stock: [string, string, number][] = [
  ["TEE-BLK-M", "A-01-01", 40],
  ["TEE-BLK-M", "A-01-02", 15],
  ["TEE-WHT-L", "A-01-02", 32],
  ["HOOD-GRY-L", "A-02-01", 18],
  ["HOOD-GRY-L", "B-01-01", 6],
  ["CAP-NVY", "A-02-01", 8],
  ["MUG-WHT", "B-02-01", 60],
  ["MUG-WHT", "B-02-02", 24],
  ["BTL-STL-750", "B-01-01", 45],
  ["BAG-TOTE", "C-01-01", 70],
  ["NOTE-A5", "C-01-01", 120],
  ["NOTE-A5", "C-03-01", 50],
  ["PEN-BLU-10", "C-03-01", 4],
  ["STK-LOGO", "C-03-01", 200],
];

type OrderStatus = "DRAFT" | "CONFIRMED" | "PICKING" | "PACKED" | "SHIPPED" | "CANCELLED";

/** Create an order and put it into `status` with stock levels consistent with that state. */
async function makeOrder(
  reference: string,
  customer: string,
  status: OrderStatus,
  lines: [string, number][],
  daysAgo: number,
) {
  const createdAt = new Date(Date.now() - daysAgo * 86_400_000);
  const order = await prisma.order.create({ data: { reference, customer, status, createdAt } });
  let firstAllocation = true;

  for (const [sku, quantity] of lines) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
    const line = await prisma.orderLine.create({
      data: { orderId: order.id, productId: product.id, quantity },
    });
    if (status === "DRAFT" || status === "CANCELLED") continue;

    const bins = await prisma.stockLevel.findMany({ where: { productId: product.id } });
    const plan = allocate(
      bins.map((b) => ({ id: b.id, available: b.onHand - b.reserved })),
      quantity,
    );
    if (!plan) throw new Error(`Seed: not enough stock for ${sku}`);

    for (const p of plan) {
      const shipped = status === "SHIPPED";
      const picked = shipped || status === "PACKED" || (status === "PICKING" && firstAllocation);
      firstAllocation = false;
      const bin = bins.find((b) => b.id === p.binId)!;

      await prisma.allocation.create({
        data: { orderLineId: line.id, stockLevelId: p.binId, quantity: p.quantity, picked },
      });
      if (picked) {
        await prisma.orderLine.update({
          where: { id: line.id },
          data: { picked: { increment: p.quantity } },
        });
      }
      if (shipped) {
        await prisma.stockLevel.update({
          where: { id: p.binId },
          data: { onHand: { decrement: p.quantity } },
        });
        await prisma.stockMovement.create({
          data: {
            productId: product.id,
            locationId: bin.locationId,
            delta: -p.quantity,
            type: "OUTBOUND",
            note: `Shipped ${reference}`,
            createdAt,
          },
        });
      } else {
        await prisma.stockLevel.update({
          where: { id: p.binId },
          data: { reserved: { increment: p.quantity } },
        });
      }
    }
  }
}

async function main() {
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    });
  }
  for (const code of locations) {
    await prisma.location.upsert({ where: { code }, update: {}, create: { code } });
  }
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }

  // Sample stock and orders are only created on a fresh database.
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
      data: {
        productId: product.id,
        locationId: location.id,
        delta: qty,
        type: "INBOUND",
        note: "Opening stock",
        createdAt: new Date(Date.now() - 10 * 86_400_000),
      },
    });
  }

  await makeOrder("SO-00001", "Aarav Traders", "SHIPPED", [["TEE-BLK-M", 12], ["MUG-WHT", 10]], 7);
  await makeOrder("SO-00002", "Bright Cafe", "SHIPPED", [["MUG-WHT", 30], ["BAG-TOTE", 20]], 5);
  await makeOrder("SO-00003", "Kiran Sports Club", "PACKED", [["HOOD-GRY-L", 10], ["CAP-NVY", 4]], 3);
  await makeOrder("SO-00004", "Nisha Boutique", "PICKING", [["TEE-BLK-M", 30], ["STK-LOGO", 40]], 2);
  await makeOrder("SO-00005", "Campus Store", "CONFIRMED", [["NOTE-A5", 90], ["BTL-STL-750", 15]], 1);
  await makeOrder("SO-00006", "Riya Gifts", "DRAFT", [["TEE-WHT-L", 10], ["BAG-TOTE", 12]], 1);
  await makeOrder("SO-00007", "Metro Office Supplies", "CANCELLED", [["PEN-BLU-10", 3]], 4);

  console.log("Seeded demo data.");
}

main().finally(() => prisma.$disconnect());
