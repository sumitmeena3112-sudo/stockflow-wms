import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "./http.js";

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export interface AuthUser {
  id: string;
  role: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

export const signToken = (user: AuthUser) =>
  jwt.sign(user, secret(), { expiresIn: "12h" });

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = jwt.verify(token, secret()) as AuthUser;
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, "Not authenticated"));
  }
}

export const requireRole =
  (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, "Not allowed"));
    }
    next();
  };
