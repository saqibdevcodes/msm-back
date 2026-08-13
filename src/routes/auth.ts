import { Router } from "express";
import {
  login,
  register,
  profile,
  resetPassword,
  forgotPassword,
  changePassword,
  logout,
} from "../controllers/auth.ts";
import { authMiddleware, adminMiddleware } from "../middlewares/auth.ts";

const router = Router();

router.post("/login", login);
router.post("/register", register);
router.get("/profile/:id", authMiddleware, profile);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", authMiddleware, changePassword);
router.post("/logout", authMiddleware, logout);

export default router;
