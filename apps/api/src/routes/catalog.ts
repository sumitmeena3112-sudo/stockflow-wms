import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth, requireRole, signToken } from "../auth.js";
import { HttpError, wrap } from "../http.js";

export const catalog = Router();

// ---- auth ----
catalog.post(
  "/auth/login",
  wrap(async (req, res) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, "Wrong email or password");
    }
    res.json({
      token: signToken({ id: user.id, role: user.role }),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  }),
);

catalog.use(requireAuth);

// ---- products ----
catalog.get(
  "/products",
  wrap(async (_req, res) => {
    res.json(await prisma.product.findMany({ orderBy: { sku: "asc" } }));
  }),
);

catalog.post(
  "/products",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const data = z
      .object({ sku: z.string().trim().min(1), name: z.string().trim().min(1) })
      .parse(req.body);
    if (await prisma.product.findUnique({ where: { sku: data.sku } })) {
      throw new HttpError(409, "SKU already exists");
    }
    res.status(201).json(await prisma.product.create({ data }));
  }),
);

// ---- locations ----
catalog.get(
  "/locations",
  wrap(async (_req, res) => {
    res.json(await prisma.location.findMany({ orderBy: { code: "asc" } }));
  }),
);

catalog.post(
  "/locations",
  requireRole("ADMIN"),
  wrap(async (req, res) => {
    const data = z.object({ code: z.string().trim().min(1) }).parse(req.body);
    if (await prisma.location.findUnique({ where: { code: data.code } })) {
      throw new HttpError(409, "Location already exists");
    }
    res.status(201).json(await prisma.location.create({ data }));
  }),
);
