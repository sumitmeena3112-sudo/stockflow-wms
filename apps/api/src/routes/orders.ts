import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, wrap } from "../http.js";
import { allocate } from "../allocate.js";

export const orders = Router();
orders.use(requireAuth);

const include = {
  lines: {
    include: {
      product: true,
      allocations: { include: { stockLevel: { include: { location: true } } } },
    },
  },
};

const load = async (id: string) => {
  const order = await prisma.order.findUnique({ where: { id }, include });
  if (!order) throw new HttpError(404, "Order not found");
  return order;
};

orders.get(
  "/orders",
  wrap(async (_req, res) => {
    res.json(
      await prisma.order.findMany({
        include: { lines: { include: { product: true } } },
        orderBy: { createdAt: "desc" },
      }),
    );
  }),
);

orders.get(
  "/orders/:id",
  wrap(async (req, res) => {
    res.json(await load(req.params.id));
  }),
);

orders.post(
  "/orders",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const data = z
      .object({
        customer: z.string().trim().min(1),
        lines: z
          .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
          .min(1),
      })
      .parse(req.body);

    const count = await prisma.order.count();
    const reference = `SO-${String(count + 1).padStart(5, "0")}`;
    const order = await prisma.order.create({
      data: { reference, customer: data.customer, lines: { create: data.lines } },
      include,
    });
    res.status(201).json(order);
  }),
);

// Reserve stock and build the pick list.
orders.post(
  "/orders/:id/confirm",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { product: true } } },
      });
      if (!order) throw new HttpError(404, "Order not found");
      if (order.status !== "DRAFT") throw new HttpError(409, "Only draft orders can be confirmed");

      for (const line of order.lines) {
        const bins = await tx.stockLevel.findMany({ where: { productId: line.productId } });
        const plan = allocate(
          bins.map((b) => ({ id: b.id, available: b.onHand - b.reserved })),
          line.quantity,
        );
        if (!plan) {
          throw new HttpError(409, `Not enough stock for ${line.product.sku}`);
        }
        for (const p of plan) {
          await tx.allocation.create({
            data: { orderLineId: line.id, stockLevelId: p.binId, quantity: p.quantity },
          });
          await tx.stockLevel.update({
            where: { id: p.binId },
            data: { reserved: { increment: p.quantity } },
          });
        }
      }
      await tx.order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    });
    res.json(await load(req.params.id));
  }),
);

// Mark one pick-list row as picked. Pickers and admins may do this.
orders.post(
  "/orders/:id/allocations/:allocationId/pick",
  wrap(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { allocations: true } } },
      });
      if (!order) throw new HttpError(404, "Order not found");
      if (order.status !== "CONFIRMED" && order.status !== "PICKING") {
        throw new HttpError(409, "Order is not being picked");
      }
      const allocation = order.lines
        .flatMap((l) => l.allocations)
        .find((a) => a.id === req.params.allocationId);
      if (!allocation) throw new HttpError(404, "Pick row not found");
      if (allocation.picked) throw new HttpError(409, "Already picked");

      await tx.allocation.update({ where: { id: allocation.id }, data: { picked: true } });
      await tx.orderLine.update({
        where: { id: allocation.orderLineId },
        data: { picked: { increment: allocation.quantity } },
      });

      const allPicked = order.lines
        .flatMap((l) => l.allocations)
        .every((a) => a.picked || a.id === allocation.id);
      await tx.order.update({
        where: { id: order.id },
        data: { status: allPicked ? "PACKED" : "PICKING" },
      });
    });
    res.json(await load(req.params.id));
  }),
);

// Hand over to the carrier: stock leaves the building.
orders.post(
  "/orders/:id/ship",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { allocations: { include: { stockLevel: true } } } } },
      });
      if (!order) throw new HttpError(404, "Order not found");
      if (order.status !== "PACKED") throw new HttpError(409, "Order is not packed yet");

      for (const line of order.lines) {
        for (const a of line.allocations) {
          await tx.stockLevel.update({
            where: { id: a.stockLevelId },
            data: { onHand: { decrement: a.quantity }, reserved: { decrement: a.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              locationId: a.stockLevel.locationId,
              delta: -a.quantity,
              type: "OUTBOUND",
              note: `Shipped ${order.reference}`,
            },
          });
        }
      }
      await tx.order.update({ where: { id: order.id }, data: { status: "SHIPPED" } });
    });
    res.json(await load(req.params.id));
  }),
);

// Cancel and release any reserved stock.
orders.post(
  "/orders/:id/cancel",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: req.params.id },
        include: { lines: { include: { allocations: true } } },
      });
      if (!order) throw new HttpError(404, "Order not found");
      if (order.status === "SHIPPED" || order.status === "CANCELLED") {
        throw new HttpError(409, `Cannot cancel a ${order.status.toLowerCase()} order`);
      }
      for (const line of order.lines) {
        for (const a of line.allocations) {
          await tx.stockLevel.update({
            where: { id: a.stockLevelId },
            data: { reserved: { decrement: a.quantity } },
          });
        }
        await tx.allocation.deleteMany({ where: { orderLineId: line.id } });
        await tx.orderLine.update({ where: { id: line.id }, data: { picked: 0 } });
      }
      await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    });
    res.json(await load(req.params.id));
  }),
);
