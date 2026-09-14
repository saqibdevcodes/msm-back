import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { prisma } from "../lib/prisma";

const secret = (() => {
  const value = process.env.JWT_SECRET;

  if (!value) {
    throw new Error("JWT_SECRET is not defined");
  }

  return value;
})();

export interface AuthRequest extends Request {
  user?: string | JwtPayload;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      message: "Authorization header is missing",
    });
  }

  const [scheme, token] = authHeader.trim().split(/\s+/);

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({
      message: "Authorization header must be: Bearer <token>",
    });
  }

  try {
    const decoded = jwt.verify(token, secret);

    req.user = decoded;

    next();
  } catch (error) {
    console.error("JWT verification error:", error);

    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        message: "Token expired",
        expiredAt: error.expiredAt,
      });
    }

    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        message: "Invalid token",
        reason: error.message,
      });
    }

    return res.status(401).json({
      message: "Token verification failed",
    });
  }
}

export async function adminMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const user = (req as any).user;

  const userDB = (await prisma.user.findUnique({
    where: { email: user.userId },
  })) as any;

  if (userDB.role !== "admin") {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
}
