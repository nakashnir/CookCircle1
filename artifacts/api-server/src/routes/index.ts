import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cookcircleRouter from "./cookcircle";
import sessionRouter from "./session";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(sessionRouter);
router.use(cookcircleRouter);

export default router;
