import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveCompanyScope } from "../middlewares/companyScope";
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
import { billingRouter, billingPublicRouter } from "./billing";
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
import usersRouter from "./users";
import salesRouter from "./sales";
import radiusRouter from "./radius";
import vpnRouter from "./vpn";
import securityEventsRouter from "./security-events";
import blockedIpsRouter from "./blocked-ips";
import trafficRouter from "./traffic";
import provisionRouter from "./provision";
import openaiRouter from "./openai";
import passwordResetRouter from "./password-reset";
import companiesRouter from "./companies";
import oltsRouter from "./olts";

const router: IRouter = Router();

// Public routes — no auth required
router.use(healthRouter);
router.use(macVendorRouter);
router.use(setupRouter); // setup wizard API — public

// Zero-touch provisioning — public (MikroTik routers call these with a token, no session)
router.use(provisionRouter);

// M-Pesa callback endpoints are public (Safaricom calls them directly with no session)
router.use(mpesaPublicRouter);
router.use(billingPublicRouter);

// Hotspot portal API — public (captive portal for WiFi customers)
router.use(hotspotPortalRouter);

// Password reset — public (used by unauthenticated users on the sign-in page)
router.use(passwordResetRouter);

// All routes below require a valid session
router.use(requireAuth);

// Resolve companyId + enforce access suspension for every authenticated
// route below (deny-by-default). Owner requests are never suspended; they
// only get an explicit companyId when passing ?companyId= for support/debug
// purposes. Individual route files may still call resolveCompanyScope
// themselves (idempotent) for explicitness, but this global pass ensures no
// authenticated route can be reached by a suspended tenant by omission.
router.use(resolveCompanyScope);

// M-Pesa staff actions (STK Push initiation, config status check) — auth required
router.use(mpesaProtectedRouter);

// Company subscription renewal (M-Pesa STK Push initiation + Stripe checkout) — auth required
router.use(billingRouter);

// Owner-only tenant (company) management
router.use(companiesRouter);

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
router.use(usersRouter);
router.use(salesRouter);
router.use(radiusRouter);
router.use(vpnRouter);
router.use(securityEventsRouter);
router.use(blockedIpsRouter);
router.use(trafficRouter);
  router.use(oltsRouter);
router.use(openaiRouter);

export default router;
