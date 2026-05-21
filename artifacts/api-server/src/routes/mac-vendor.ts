import { Router } from "express";

const router = Router();

const cache = new Map<string, string | null>();

router.get("/mac-vendor/:oui", async (req, res) => {
  const raw = (req.params.oui ?? "").slice(0, 17).replace(/[^0-9A-Fa-f:.\-]/g, "");
  if (!raw) { res.status(400).json({ error: "Invalid OUI" }); return; }

  if (cache.has(raw)) {
    res.json({ vendor: cache.get(raw) ?? null });
    return;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const upstream = await fetch(`https://api.macvendors.com/${encodeURIComponent(raw)}`, {
      headers: { Accept: "text/plain" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!upstream.ok) {
      cache.set(raw, null);
      res.json({ vendor: null });
      return;
    }
    const vendor = (await upstream.text()).trim() || null;
    cache.set(raw, vendor);
    res.json({ vendor });
  } catch {
    cache.set(raw, null);
    res.json({ vendor: null });
  }
});

export default router;
