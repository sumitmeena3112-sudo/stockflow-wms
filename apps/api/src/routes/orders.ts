import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, wrap } from "../http.js";
import { allocateWithOverflow } from "../allocate.js";
import { orderAlerts } from "../alerts.js";
import { suggestCourier } from "../courier.js";

export const orders = Router();
orders.use(requireAuth);

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const ACTIVE = ["RECEIVED", "PROCESSED", "PICKING", "PACKING", "STAGED"];

const detailInclude = {
  courier: true,
  lines: {
    include: {
      product: true,
      allocations: {
        include: { stockLevel: { include: { location: { include: { warehouse: true } } } } },
      },
    },
  },
  events: { orderBy: { createdAt: "desc" } },
  issues: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.OrderInclude;

const withAlerts = <T extends Parameters<typeof orderAlerts>[0]>(o: T) => ({
  ...o,
  alerts: orderAlerts(o),
});

const log = (db: Db, orderId: string, message: string, actor: string) =>
  db.orderEvent.create({ data: { orderId, message, actor } });

const setStatus = (tx: Tx, id: string, status: string, extra: Prisma.OrderUpdateInput = {}) =>
  tx.order.update({ where: { id }, data: { status, statusUpdatedAt: new Date(), ...extra } });

const loadDetail = async (id: string) => {
  const order = await prisma.order.findUnique({ where: { id }, include: detailInclude });
  if (!order) throw new HttpError(404, "Order not found");
  const couriers = await prisma.courier.findMany({ where: { active: true } });
  return {
    ...withAlerts(order),
    suggestedCourier: suggestCourier(order.priority, couriers),
  };
};

/** Wrong SKU scanned: HttpError 422. We keep a record so problems are never forgotten. */
const assertSku = (expected: string, scanned: string) => {
  if (expected.trim().toLowerCase() !== scanned.trim().toLowerCase()) {
    throw new HttpError(
      422,
      `Wrong item: expected ${expected} but scanned ${scanned.trim().toUpperCase()}. Put it back and scan the right one.`,
    );
  }
};

async function guardMismatch<T>(orderId: string, actor: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError && e.status === 422) {
      await log(prisma, orderId, e.message, actor);
      const open = await prisma.issue.findFirst({ where: { orderId, type: "WRONG_ITEM", status: "OPEN" } });
      if (!open) {
        await prisma.issue.create({
          data: { orderId, type: "WRONG_ITEM", description: e.message, reportedBy: actor },
        });
      }
    }
    throw e;
  }
}

const byUrgency = (
  a: { status: string; priority: string; dueAt: Date },
  b: { status: string; priority: string; dueAt: Date },
) => {
  const done = (s: string) => (ACTIVE.includes(s) ? 0 : 1);
  return (
    done(a.status) - done(b.status) ||
    Number(b.priority === "PRIORITY") - Number(a.priority === "PRIORITY") ||
    a.dueAt.getTime() - b.dueAt.getTime()
  );
};

// ---------- reading ----------

orders.get(
  "/orders",
  wrap(async (req, res) => {
    const f = z
      .object({
        status: z.string().optional(),
        priority: z.string().optional(),
        q: z.string().optional(),
        alerts: z.string().optional(),
      })
      .parse(req.query);

    const where: Prisma.OrderWhereInput = {};
    if (f.status) where.status = f.status;
    if (f.priority) where.priority = f.priority;
    if (f.q) where.OR = [{ reference: { contains: f.q } }, { customer: { contains: f.q } }];

    const rows = await prisma.order.findMany({
      where,
      include: { courier: true, lines: { include: { product: true } } },
      take: 500,
    });
    let list = rows.map(withAlerts);
    if (f.alerts === "1") list = list.filter((o) => o.alerts.length > 0);
    list.sort(byUrgency);
    res.json(list);
  }),
);

// Everything the warehouse team needs to do right now, most urgent first.
orders.get(
  "/tasks",
  wrap(async (_req, res) => {
    const rows = await prisma.order.findMany({
      where: { status: { in: ACTIVE } },
      include: { courier: true, lines: { include: { product: true } } },
    });
    const list = rows.map(withAlerts).sort(byUrgency);

    const pickups: Record<string, { courier: any; orders: typeof list }> = {};
    for (const o of list.filter((x) => x.status === "STAGED" && x.courier)) {
      pickups[o.courier!.id] ??= { courier: o.courier, orders: [] };
      pickups[o.courier!.id].orders.push(o);
    }

    const [transfers, inbound] = await Promise.all([
      prisma.allocation.findMany({
        where: { needsTransfer: true, orderLine: { order: { status: { in: ["PROCESSED", "PICKING"] } } } },
        include: {
          orderLine: { include: { order: true, product: true } },
          stockLevel: { include: { location: true } },
        },
      }),
      prisma.delivery.findMany({ where: { status: { not: "PUT_AWAY" } }, orderBy: { expectedAt: "asc" } }),
    ]);

    res.json({
      toProcess: list.filter((o) => o.status === "RECEIVED"),
      pick: list.filter((o) => o.status === "PROCESSED" || o.status === "PICKING"),
      pack: list.filter((o) => o.status === "PACKING"),
      pickups: Object.values(pickups),
      transfers,
      inbound,
    });
  }),
);

orders.get(
  "/orders/:id",
  wrap(async (req, res) => {
    res.json(await loadDetail(req.params.id));
  }),
);

// ---------- 1. order received ----------

orders.post(
  "/orders",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const data = z
      .object({
        customer: z.string().trim().min(1),
        channel: z.string().trim().min(1).default("Website"),
        address: z.string().trim().default(""),
        priority: z.enum(["PRIORITY", "STANDARD"]).default("STANDARD"),
        dueAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid due date"),
        lines: z
          .array(z.object({ productId: z.string(), quantity: z.number().int().positive() }))
          .min(1),
      })
      .parse(req.body);

    let n = (await prisma.order.count()) + 1;
    while (await prisma.order.findUnique({ where: { reference: `SO-${String(n).padStart(5, "0")}` } })) n++;
    const reference = `SO-${String(n).padStart(5, "0")}`;

    const order = await prisma.order.create({
      data: {
        reference,
        customer: data.customer,
        channel: data.channel,
        address: data.address,
        priority: data.priority,
        dueAt: new Date(data.dueAt),
        lines: { create: data.lines },
        events: { create: { message: `Order received from ${data.channel}`, actor: req.user!.name } },
      },
    });
    res.status(201).json(await loadDetail(order.id));
  }),
);

// ---------- 2. order processed: courier, label, stock reserved ----------

async function processOrder(orderId: string, courierId: string, actor: string) {
  try {
    await prisma.$transaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { lines: { include: { product: true } } },
        });
        if (!order) throw new HttpError(404, "Order not found");
        if (order.status !== "RECEIVED") throw new HttpError(409, "Only newly received orders can be processed");

        const courier = await tx.courier.findUnique({ where: { id: courierId } });
        if (!courier || !courier.active) throw new HttpError(400, "Choose a courier");

        const mainBins = await tx.location.findMany({
          where: { warehouse: { isMain: true } },
          orderBy: { code: "asc" },
        });
        let transfers = 0;

        for (const line of order.lines) {
          const levels = await tx.stockLevel.findMany({
            where: { productId: line.productId },
            include: { location: { include: { warehouse: true } } },
          });
          const asBin = (l: (typeof levels)[number]) => ({ id: l.id, available: l.onHand - l.reserved });
          const plan = allocateWithOverflow(
            levels.filter((l) => l.location.warehouse.isMain).map(asBin),
            levels.filter((l) => !l.location.warehouse.isMain).map(asBin),
            line.quantity,
          );
          if (!plan) {
            throw new HttpError(409, `Not enough stock for ${line.product.sku} (main and overflow combined)`);
          }
          const destination =
            levels.find((l) => l.location.warehouse.isMain)?.locationId ?? mainBins[0]?.id ?? null;

          for (const p of plan) {
            await tx.allocation.create({
              data: {
                orderLineId: line.id,
                stockLevelId: p.binId,
                quantity: p.quantity,
                needsTransfer: p.overflow,
                transferToLocationId: p.overflow ? destination : null,
              },
            });
            await tx.stockLevel.update({
              where: { id: p.binId },
              data: { reserved: { increment: p.quantity } },
            });
            if (p.overflow) transfers++;
          }
        }

        const tracking = `${courier.code}-${Date.now().toString(36).toUpperCase()}${Math.floor(100 + Math.random() * 900)}`;
        await setStatus(tx, order.id, "PROCESSED", {
          courier: { connect: { id: courier.id } },
          trackingNumber: tracking,
        });
        await log(
          tx,
          order.id,
          `Processed: ${courier.name}, label ${tracking}, stock reserved` +
            (transfers ? ` (${transfers} pick row(s) need a move from overflow)` : ""),
          actor,
        );
      },
      { timeout: 15000 },
    );
  } catch (e) {
    if (e instanceof HttpError && e.status === 409 && e.message.startsWith("Not enough stock")) {
      await log(prisma, orderId, e.message, actor);
      const open = await prisma.issue.findFirst({ where: { orderId, type: "STOCK_SHORT", status: "OPEN" } });
      if (!open) {
        await prisma.issue.create({
          data: { orderId, type: "STOCK_SHORT", description: e.message, reportedBy: actor },
        });
      }
    }
    throw e;
  }
}

orders.post(
  "/orders/:id/process",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const { courierId } = z.object({ courierId: z.string() }).parse(req.body);
    await processOrder(req.params.id, courierId, req.user!.name);
    res.json(await loadDetail(req.params.id));
  }),
);

// Process many orders at once, picking the courier for each automatically.
orders.post(
  "/orders/process-bulk",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1).max(300) }).parse(req.body);
    const couriers = await prisma.courier.findMany({ where: { active: true } });
    const found = await prisma.order.findMany({ where: { id: { in: ids } } });
    const results: { id: string; reference: string; ok: boolean; error?: string }[] = [];

    for (const o of found) {
      try {
        const pick = suggestCourier(o.priority, couriers);
        if (!pick) throw new HttpError(400, "No courier available");
        await processOrder(o.id, pick.courier.id, req.user!.name);
        results.push({ id: o.id, reference: o.reference, ok: true });
      } catch (e) {
        results.push({
          id: o.id,
          reference: o.reference,
          ok: false,
          error: e instanceof HttpError ? e.message : "Failed",
        });
      }
    }
    res.json({ results, processed: results.filter((r) => r.ok).length });
  }),
);

// ---------- moving stock from the overflow warehouse ----------

orders.post(
  "/allocations/:id/transfer",
  wrap(async (req, res) => {
    const actor = req.user!.name;
    let orderId = "";
    await prisma.$transaction(async (tx) => {
      const a = await tx.allocation.findUnique({
        where: { id: req.params.id },
        include: { orderLine: { include: { order: true, product: true } }, stockLevel: { include: { location: true } } },
      });
      if (!a) throw new HttpError(404, "Pick row not found");
      if (!a.needsTransfer || !a.transferToLocationId) throw new HttpError(409, "No move needed for this row");
      if (!["PROCESSED", "PICKING"].includes(a.orderLine.order.status)) {
        throw new HttpError(409, "This order is no longer being picked");
      }
      orderId = a.orderLine.orderId;

      const src = a.stockLevel;
      const dest = await tx.stockLevel.upsert({
        where: { productId_locationId: { productId: src.productId, locationId: a.transferToLocationId } },
        create: { productId: src.productId, locationId: a.transferToLocationId },
        update: {},
      });
      const toLoc = await tx.location.findUniqueOrThrow({ where: { id: a.transferToLocationId } });

      await tx.stockLevel.update({
        where: { id: src.id },
        data: { onHand: { decrement: a.quantity }, reserved: { decrement: a.quantity } },
      });
      await tx.stockLevel.update({
        where: { id: dest.id },
        data: { onHand: { increment: a.quantity }, reserved: { increment: a.quantity } },
      });
      await tx.allocation.update({
        where: { id: a.id },
        data: { stockLevelId: dest.id, needsTransfer: false, transferToLocationId: null },
      });
      const note = `Moved ${a.quantity} x ${a.orderLine.product.sku} from ${src.location.code} to ${toLoc.code} for ${a.orderLine.order.reference}`;
      await tx.stockMovement.create({
        data: { productId: src.productId, locationId: src.locationId, delta: -a.quantity, type: "TRANSFER", note },
      });
      await tx.stockMovement.create({
        data: { productId: src.productId, locationId: dest.locationId, delta: a.quantity, type: "TRANSFER", note },
      });
      await log(tx, orderId, note, actor);
    });
    res.json(await loadDetail(orderId));
  }),
);

// ---------- 3. picking (scan the SKU, wrong items are blocked) ----------

orders.post(
  "/orders/:id/allocations/:allocationId/pick",
  wrap(async (req, res) => {
    const { sku } = z.object({ sku: z.string().trim().min(1, "Scan or type the SKU") }).parse(req.body);
    const actor = req.user!.name;
    await guardMismatch(req.params.id, actor, () =>
      prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: req.params.id },
          include: { lines: { include: { product: true, allocations: true } } },
        });
        if (!order) throw new HttpError(404, "Order not found");
        if (order.status !== "PROCESSED" && order.status !== "PICKING") {
          throw new HttpError(409, "Order is not being picked");
        }
        const line = order.lines.find((l) => l.allocations.some((a) => a.id === req.params.allocationId));
        const allocation = line?.allocations.find((a) => a.id === req.params.allocationId);
        if (!line || !allocation) throw new HttpError(404, "Pick row not found");
        if (allocation.picked) throw new HttpError(409, "Already picked");
        if (allocation.needsTransfer) {
          throw new HttpError(409, "This stock is in the overflow warehouse. Move it to the main warehouse first.");
        }
        assertSku(line.product.sku, sku);

        await tx.allocation.update({ where: { id: allocation.id }, data: { picked: true } });
        await tx.orderLine.update({ where: { id: line.id }, data: { picked: { increment: allocation.quantity } } });

        const allPicked = order.lines
          .flatMap((l) => l.allocations)
          .every((a) => a.picked || a.id === allocation.id);
        await setStatus(tx, order.id, allPicked ? "PACKING" : "PICKING");
        await log(
          tx,
          order.id,
          `Picked ${allocation.quantity} x ${line.product.sku}` + (allPicked ? " - all items picked, ready to pack" : ""),
          actor,
        );
      }),
    );
    res.json(await loadDetail(req.params.id));
  }),
);

// ---------- 4. packing (verify each item again before it goes in the box) ----------

orders.post(
  "/orders/:id/lines/:lineId/pack",
  wrap(async (req, res) => {
    const { sku } = z.object({ sku: z.string().trim().min(1, "Scan or type the SKU") }).parse(req.body);
    const actor = req.user!.name;
    await guardMismatch(req.params.id, actor, async () => {
      const line = await prisma.orderLine.findUnique({
        where: { id: req.params.lineId },
        include: { product: true, order: true },
      });
      if (!line || line.orderId !== req.params.id) throw new HttpError(404, "Order line not found");
      if (line.order.status !== "PACKING") throw new HttpError(409, "Order is not at the packing step");
      if (line.packed) throw new HttpError(409, "Already packed");
      assertSku(line.product.sku, sku);
      await prisma.orderLine.update({ where: { id: line.id }, data: { packed: true } });
      await log(prisma, line.orderId, `Packed ${line.quantity} x ${line.product.sku}`, actor);
    });
    res.json(await loadDetail(req.params.id));
  }),
);

// ---------- 5. staging: the box, with its label, waits for the courier ----------

orders.post(
  "/orders/:id/stage",
  wrap(async (req, res) => {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: req.params.id },
        include: { lines: true, courier: true },
      });
      if (!order) throw new HttpError(404, "Order not found");
      if (order.status !== "PACKING") throw new HttpError(409, "Order is not at the packing step");
      if (!order.lines.every((l) => l.packed)) throw new HttpError(409, "Verify every item before staging");
      const slot = `LANE-${order.courier?.code ?? "X"}`;
      await setStatus(tx, order.id, "STAGED", { stagingSlot: slot });
      await log(tx, order.id, `Box labelled and staged in ${slot}, waiting for ${order.courier?.name}`, req.user!.name);
    });
    res.json(await loadDetail(req.params.id));
  }),
);

// ---------- 6. shipping: the courier collects ----------

async function shipOrder(tx: Tx, orderId: string, actor: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { lines: { include: { allocations: { include: { stockLevel: true } } } }, courier: true },
  });
  if (!order) throw new HttpError(404, "Order not found");
  if (order.status !== "STAGED") throw new HttpError(409, "Order is not staged yet");

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
  await setStatus(tx, order.id, "SHIPPED", { shippedAt: new Date() });
  await log(tx, order.id, `Collected by ${order.courier?.name ?? "courier"} - shipped`, actor);
}

orders.post(
  "/orders/:id/ship",
  wrap(async (req, res) => {
    await prisma.$transaction((tx) => shipOrder(tx, req.params.id, req.user!.name));
    res.json(await loadDetail(req.params.id));
  }),
);

// The courier arrives: hand over every staged box for that courier in one go.
orders.post(
  "/couriers/:id/pickup",
  wrap(async (req, res) => {
    const staged = await prisma.order.findMany({
      where: { status: "STAGED", courierId: req.params.id },
      select: { id: true },
    });
    if (staged.length === 0) throw new HttpError(409, "No staged boxes for this courier");
    for (const o of staged) {
      await prisma.$transaction((tx) => shipOrder(tx, o.id, req.user!.name));
    }
    res.json({ shipped: staged.length });
  }),
);

// ---------- cancelling releases reserved stock ----------

orders.post(
  "/orders/:id/cancel",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().optional() }).parse(req.body ?? {});
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
        await tx.orderLine.update({ where: { id: line.id }, data: { picked: 0, packed: false } });
      }
      await setStatus(tx, order.id, "CANCELLED");
      await log(tx, order.id, `Cancelled${reason ? `: ${reason}` : ""}. Reserved stock released.`, req.user!.name);
    });
    res.json(await loadDetail(req.params.id));
  }),
);
