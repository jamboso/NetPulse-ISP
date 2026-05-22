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
import { mpesaPublicRouter, mpesaProtectedRouter } from "./mpesa";
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
import monitoringRouter from "./monitoring";
import networkMapRouter from "./network-map";
import infrastructureRouter from "./infrastructure";
import setupRouter from "./setup";
import auditLogsRouter from "./audit-logs";
import systemUpdateRouter from "./system-update";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(macVendorRouter);
router.use(setupRouter); // setup wizard API — public

// M-Pesa callback endpoints are public (Safaricom calls them directly with no session)
router.use(mpesaPublicRouter);

// Hotspot portal API — public (captive portal for WiFi customers)
router.use(hotspotPortalRouter);

// All routes below require a valid session
router.use(requireAuth);

// M-Pesa staff actions (STK Push initiation, config status check) — auth required
router.use(mpesaProtectedRouter);

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
router.use(monitoringRouter);
router.use(networkMapRouter);
router.use(infrastructureRouter);
router.use(auditLogsRouter);
router.use(systemUpdateRouter);

export default router;
