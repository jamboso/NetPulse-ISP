import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import plansRouter from "./plans";
import subscriptionsRouter from "./subscriptions";
import invoicesRouter from "./invoices";
import paymentsRouter from "./payments";
import ticketsRouter from "./tickets";
import equipmentRouter from "./equipment";
import ipPoolsRouter from "./ipPools";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(customersRouter);
router.use(plansRouter);
router.use(subscriptionsRouter);
router.use(invoicesRouter);
router.use(paymentsRouter);
router.use(ticketsRouter);
router.use(equipmentRouter);
router.use(ipPoolsRouter);

export default router;
