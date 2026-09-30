import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth.js";
import { wrap } from "../http.js";
import { orderAlerts } from "../alerts.js";

export const inventory = Router();
inventory.use(requireAuth);

inventory.get(
  "/inventory",
  wrap(async (_req, res) => {
    const rows = await prisma.stockLevel.findMany({
      include: { product: true, location: { include: { warehouse: true } } },
      orderBy: [{ product: { sku: "asc" } }, { location: { code: "asc" } }],
    });
    res.json(rows.map((r) => ({ ...r, available: r.onHand - r.reserved })));
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
    const [grouped, levels, openOrders, openIssues, transfers, deliveries, stagedOrders] =
      await Promise.all([
        prisma.order.groupBy({ by: ["status"], _count: true }),
        prisma.stockLevel.findMany({ include: { location: { include: { warehouse: true } } } }),
        prisma.order.findMany({
          where: { status: { notIn: ["SHIPPED", "CANCELLED"] } },
          include: { courier: true },
        }),
        prisma.issue.count({ where: { status: "OPEN" } }),
        prisma.allocation.count({
          where: { needsTransfer: true, orderLine: { order: { status: { in: ["PROCESSED", "PICKING"] } } } },
        }),
        prisma.delivery.count({ where: { status: { not: "PUT_AWAY" } } }),
        prisma.order.findMany({
          where: { status: "STAGED" },
          include: { courier: true },
        }),
      ]);

    const orders: Record<string, number> = {};
    for (const g of grouped) orders[g.status] = g._count;

    const attention = openOrders
      .map((o) => ({
        id: o.id,
        reference: o.reference,
        customer: o.customer,
        priority: o.priority,
        status: o.status,
        dueAt: o.dueAt,
        alerts: orderAlerts(o),
      }))
      .filter((o) => o.alerts.length > 0)
      .sort(
        (a, b) =>
          Number(b.alerts.some((x) => x.severity === "high")) -
            Number(a.alerts.some((x) => x.severity === "high")) ||
          a.dueAt.getTime() - b.dueAt.getTime(),
      );

    const pickups: Record<string, { courier: string; pickupTime: string; staged: number }> = {};
    for (const o of stagedOrders) {
      if (!o.courier) continue;
      pickups[o.courier.id] ??= { courier: o.courier.name, pickupTime: o.courier.pickupTime, staged: 0 };
      pickups[o.courier.id].staged += 1;
    }

    res.json({
      orders,
      openOrders: openOrders.length,
      priorityOpen: openOrders.filter((o) => o.priority === "PRIORITY").length,
      overdue: attention.filter((o) => o.alerts.some((a) => a.code === "OVERDUE")).length,
      attention: attention.slice(0, 10),
      openIssues,
      pendingTransfers: transfers,
      deliveriesInProgress: deliveries,
      pickups: Object.values(pickups),
      totalOnHand: levels.reduce((s, l) => s + l.onHand, 0),
      totalReserved: levels.reduce((s, l) => s + l.reserved, 0),
      overflowUnits: levels
        .filter((l) => !l.location.warehouse.isMain)
        .reduce((s, l) => s + l.onHand, 0),
      lowStockBins: levels.filter((l) => l.onHand - l.reserved <= 5).length,
    });
  }),
);
