import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import customersRouter from "./customers";
import plansRouter from "./plans";
import subscriptionsRouter from "./subscriptions";
import invoicesRouter from "./invoices";
import paymentsRouter from "./payments";
import ticketsRouter from "./tickets";
import equipmentRouter from "./equipment";
import ipPoolsRouter from "./ipPools";
import mpesaRouter from "./mpesa";
import settingsRouter from "./settings";
import routersRouter from "./routers";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);

// M-Pesa callback endpoints are public (Safaricom calls them directly)
// but STK Push and status require auth — handled inside mpesaRouter
router.use(mpesaRouter);

// All routes below require a valid Clerk session
router.use(requireAuth);

router.use(dashboardRouter);
router.use(customersRouter);
router.use(plansRouter);
router.use(subscriptionsRouter);
router.use(invoicesRouter);
router.use(paymentsRouter);
router.use(ticketsRouter);
router.use(equipmentRouter);
router.use(ipPoolsRouter);
router.use(settingsRouter);
router.use(routersRouter);

export default router;
