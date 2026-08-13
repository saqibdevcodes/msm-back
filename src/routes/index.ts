import { Router } from "express";
import authRouter from "./auth.ts";
import userRouter from "./user.ts";
import projectRouter from "./project.ts";
import fieldResponseRouter from "./fieldResponse.ts";
import performanceRouter from "./performance.ts";
import me from "./me.ts";
import dashboardRoutes from "./dashboard.ts";
import projectProgressRoutes from "./projectProgress.ts";
import userExportRoutes from "./userExport.ts";

const router = Router();

router.get("/", (req, res) => {
  res.send("Hello, World!");
});
router.use("/auth", authRouter);
router.use("/users", userRouter);
router.use("/projects", projectRouter);
router.use("/field-responses", fieldResponseRouter);
router.use("/performance", performanceRouter);
router.use("/me", me);
router.use("/dashboard", dashboardRoutes);
router.use("/", projectProgressRoutes);
router.use("/users", userExportRoutes);

export default router;
