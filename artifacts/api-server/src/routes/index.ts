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
import rosRouter from "./ros";
import pppoeRouter from "./pppoe";
import hotspotAdminRouter from "./hotspot-admin";
import hotspotPortalRouter from "./hotspot-portal";
import customerSessionsRouter from "./customer-sessions";
import customerExtrasRouter from "./customer-extras";
import macVendorRouter from "./mac-vendor";
import complianceRouter from "./compliance";
import smsRouter from "./sms";
import smsTemplatesRouter from "./sms-templates";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(macVendorRouter);

// M-Pesa callback endpoints are public (Safaricom calls them directly)
// but STK Push and status require auth — handled inside mpesaRouter
router.use(mpesaRouter);

// Hotspot portal API — public (captive portal for WiFi customers)
router.use(hotspotPortalRouter);

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
router.use(rosRouter);
router.use(pppoeRouter);
router.use(hotspotAdminRouter);
router.use(customerSessionsRouter);
router.use(customerExtrasRouter);
router.use(complianceRouter);
router.use(smsRouter);
router.use(smsTemplatesRouter);

export default router;
