import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const users = [
    { email: "admin@stockflow.local", name: "Demo Admin", password: "Admin@12345", role: "ADMIN" },
    { email: "picker@stockflow.local", name: "Demo Picker", password: "Picker@12345", role: "PICKER" },
  ];
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

  const locations = ["A-01-01", "A-01-02", "B-02-01"];
  for (const code of locations) {
    await prisma.location.upsert({ where: { code }, update: {}, create: { code } });
  }

  const products = [
    { sku: "TEE-BLK-M", name: "Black T-Shirt (M)" },
    { sku: "MUG-WHT", name: "White Ceramic Mug" },
    { sku: "CAP-NVY", name: "Navy Cap" },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }

  const stock: [string, string, number][] = [
    ["TEE-BLK-M", "A-01-01", 40],
    ["TEE-BLK-M", "A-01-02", 15],
    ["MUG-WHT", "B-02-01", 60],
    ["CAP-NVY", "A-01-02", 8],
  ];
  for (const [sku, code, qty] of stock) {
    const product = await prisma.product.findUniqueOrThrow({ where: { sku } });
    const location = await prisma.location.findUniqueOrThrow({ where: { code } });
    await prisma.stockLevel.upsert({
      where: { productId_locationId: { productId: product.id, locationId: location.id } },
      update: {},
      create: { productId: product.id, locationId: location.id, onHand: qty },
    });
  }
  console.log("Seeded demo data.");
}

main().finally(() => prisma.$disconnect());
