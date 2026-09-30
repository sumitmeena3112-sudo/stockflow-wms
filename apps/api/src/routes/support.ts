import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, wrap } from "../http.js";

export const support = Router();
support.use(requireAuth);

// ================= issues: problems are logged, not handled informally =================

const ISSUE_TYPES = ["STOCK_SHORT", "WRONG_ITEM", "DAMAGED", "MISSING_ITEM", "MISSED_PICKUP", "DELIVERY", "OTHER"] as const;

support.get(
  "/issues",
  wrap(async (req, res) => {
    const { status } = z.object({ status: z.string().optional() }).parse(req.query);
    res.json(
      await prisma.issue.findMany({
        where: status ? { status } : {},
        include: { order: { select: { id: true, reference: true } } },
        orderBy: [{ status: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
    );
  }),
);

support.post(
  "/issues",
  wrap(async (req, res) => {
    const data = z
      .object({
        orderId: z.string().optional(),
        type: z.enum(ISSUE_TYPES),
        description: z.string().trim().min(3, "Describe the problem"),
      })
      .parse(req.body);
    if (data.orderId && !(await prisma.order.findUnique({ where: { id: data.orderId } }))) {
      throw new HttpError(404, "Order not found");
    }
    const issue = await prisma.issue.create({
      data: { ...data, orderId: data.orderId || null, reportedBy: req.user!.name },
    });
    if (issue.orderId) {
      await prisma.orderEvent.create({
        data: { orderId: issue.orderId, actor: req.user!.name, message: `Problem reported (${data.type}): ${data.description}` },
      });
    }
    res.status(201).json(issue);
  }),
);

support.post(
  "/issues/:id/resolve",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(1, "Add a short resolution note") }).parse(req.body);
    const issue = await prisma.issue.findUnique({ where: { id: req.params.id } });
    if (!issue) throw new HttpError(404, "Issue not found");
    if (issue.status === "RESOLVED") throw new HttpError(409, "Already resolved");
    const updated = await prisma.issue.update({
      where: { id: issue.id },
      data: { status: "RESOLVED", resolutionNote: note, resolvedAt: new Date() },
    });
    if (issue.orderId) {
      await prisma.orderEvent.create({
        data: { orderId: issue.orderId, actor: req.user!.name, message: `Problem resolved (${issue.type}): ${note}` },
      });
    }
    res.json(updated);
  }),
);

// ================= inbound deliveries: unload, check, put away =================

const deliveryInclude = { lines: { include: { product: true } } };

support.get(
  "/deliveries",
  wrap(async (_req, res) => {
    res.json(
      await prisma.delivery.findMany({ include: deliveryInclude, orderBy: { expectedAt: "desc" }, take: 100 }),
    );
  }),
);

support.post(
  "/deliveries",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const data = z
      .object({
        supplier: z.string().trim().min(1),
        expectedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date"),
        lines: z.array(z.object({ productId: z.string(), expectedQty: z.number().int().positive() })).min(1),
      })
      .parse(req.body);
    const n = (await prisma.delivery.count()) + 1;
    const delivery = await prisma.delivery.create({
      data: {
        reference: `IN-${String(n).padStart(4, "0")}-${Date.now().toString(36).slice(-3).toUpperCase()}`,
        supplier: data.supplier,
        expectedAt: new Date(data.expectedAt),
        lines: { create: data.lines },
      },
      include: deliveryInclude,
    });
    res.status(201).json(delivery);
  }),
);

// Count what actually arrived and note damage. Differences are logged as issues.
support.post(
  "/deliveries/:id/check",
  wrap(async (req, res) => {
    const { lines } = z
      .object({
        lines: z.array(
          z.object({ id: z.string(), receivedQty: z.number().int().min(0), damagedQty: z.number().int().min(0) }),
        ),
      })
      .parse(req.body);

    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id }, include: deliveryInclude });
    if (!delivery) throw new HttpError(404, "Delivery not found");
    if (delivery.status !== "EXPECTED") throw new HttpError(409, "This delivery has already been checked");

    const problems: string[] = [];
    await prisma.$transaction(async (tx) => {
      for (const dl of delivery.lines) {
        const input = lines.find((l) => l.id === dl.id);
        if (!input) throw new HttpError(400, `Enter a count for ${dl.product.sku}`);
        if (input.damagedQty > input.receivedQty) {
          throw new HttpError(400, `${dl.product.sku}: damaged cannot exceed received`);
        }
        await tx.deliveryLine.update({
          where: { id: dl.id },
          data: { receivedQty: input.receivedQty, damagedQty: input.damagedQty },
        });
        if (input.receivedQty !== dl.expectedQty) {
          problems.push(`${dl.product.sku}: expected ${dl.expectedQty}, received ${input.receivedQty}`);
        }
        if (input.damagedQty > 0) problems.push(`${dl.product.sku}: ${input.damagedQty} damaged`);
      }
      await tx.delivery.update({ where: { id: delivery.id }, data: { status: "CHECKED" } });
      if (problems.length > 0) {
        await tx.issue.create({
          data: {
            type: "DELIVERY",
            description: `${delivery.reference} from ${delivery.supplier}: ${problems.join("; ")}`,
            reportedBy: req.user!.name,
          },
        });
      }
    });
    res.json({ ok: true, problems });
  }),
);

// Shelve the good units. Only now does the stock become sellable.
support.post(
  "/deliveries/:id/putaway",
  wrap(async (req, res) => {
    const { lines } = z
      .object({ lines: z.array(z.object({ id: z.string(), locationId: z.string().optional() })) })
      .parse(req.body);

    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id }, include: deliveryInclude });
    if (!delivery) throw new HttpError(404, "Delivery not found");
    if (delivery.status !== "CHECKED") throw new HttpError(409, "Check the delivery before putting it away");

    await prisma.$transaction(async (tx) => {
      for (const dl of delivery.lines) {
        const good = dl.receivedQty - dl.damagedQty;
        if (good <= 0) continue;
        const locationId = lines.find((l) => l.id === dl.id)?.locationId;
        if (!locationId) throw new HttpError(400, `Choose a bin for ${dl.product.sku}`);
        if (!(await tx.location.findUnique({ where: { id: locationId } }))) {
          throw new HttpError(404, "Bin not found");
        }
        await tx.stockLevel.upsert({
          where: { productId_locationId: { productId: dl.productId, locationId } },
          create: { productId: dl.productId, locationId, onHand: good },
          update: { onHand: { increment: good } },
        });
        await tx.stockMovement.create({
          data: { productId: dl.productId, locationId, delta: good, type: "INBOUND", note: `Put away from ${delivery.reference}` },
        });
        await tx.deliveryLine.update({ where: { id: dl.id }, data: { locationId } });
      }
      await tx.delivery.update({ where: { id: delivery.id }, data: { status: "PUT_AWAY" } });
    });
    res.json({ ok: true });
  }),
);
