import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, wrap } from "../http.js";

export const inventory = Router();
inventory.use(requireAuth);

inventory.get(
  "/inventory",
  wrap(async (_req, res) => {
    const rows = await prisma.stockLevel.findMany({
      include: { product: true, location: true },
      orderBy: [{ product: { sku: "asc" } }, { location: { code: "asc" } }],
    });
    res.json(rows.map((r) => ({ ...r, available: r.onHand - r.reserved })));
  }),
);

// Receive inbound goods into a bin.
inventory.post(
  "/inventory/receive",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const { productId, locationId, quantity } = z
      .object({
        productId: z.string(),
        locationId: z.string(),
        quantity: z.number().int().positive(),
      })
      .parse(req.body);

    const [product, location] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.location.findUnique({ where: { id: locationId } }),
    ]);
    if (!product || !location) throw new HttpError(404, "Product or location not found");

    await prisma.$transaction([
      prisma.stockLevel.upsert({
        where: { productId_locationId: { productId, locationId } },
        create: { productId, locationId, onHand: quantity },
        update: { onHand: { increment: quantity } },
      }),
      prisma.stockMovement.create({
        data: { productId, locationId, delta: quantity, type: "INBOUND", note: "Goods received" },
      }),
    ]);
    res.status(201).json({ ok: true });
  }),
);

inventory.get(
  "/movements",
  wrap(async (_req, res) => {
    res.json(
      await prisma.stockMovement.findMany({
        include: { product: true, location: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
  }),
);

inventory.get(
  "/dashboard",
  wrap(async (_req, res) => {
    const [grouped, levels] = await Promise.all([
      prisma.order.groupBy({ by: ["status"], _count: true }),
      prisma.stockLevel.findMany(),
    ]);
    const orders: Record<string, number> = {};
    for (const g of grouped) orders[g.status] = g._count;
    res.json({
      orders,
      totalOnHand: levels.reduce((s, l) => s + l.onHand, 0),
      totalReserved: levels.reduce((s, l) => s + l.reserved, 0),
      lowStockBins: levels.filter((l) => l.onHand - l.reserved <= 5).length,
    });
  }),
);
