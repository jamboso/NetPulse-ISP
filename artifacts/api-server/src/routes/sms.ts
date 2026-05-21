import { Router } from "express";
import { getSettings, sendSms } from "../lib/sms";

const router = Router();

// POST /api/sms/test  { to, message? }
router.post("/sms/test", async (req, res) => {
  const { to, message } = req.body as { to?: string; message?: string };
  if (!to) { res.status(400).json({ success: false, message: "Phone number is required." }); return; }
  const s = await getSettings();
  if (!s.smsProvider) { res.status(400).json({ success: false, message: "No SMS provider configured. Go to Settings → SMS." }); return; }
  const result = await sendSms(s, to, message ?? "Test message from NetPulse ISP Manager. Your SMS gateway is working!");
  res.status(result.success ? 200 : 502).json(result);
});

export default router;
