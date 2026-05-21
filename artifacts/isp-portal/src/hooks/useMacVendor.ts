import { useState, useEffect } from "react";

const cache = new Map<string, string | null>();

function normalizeOui(mac: string): string {
  const hex = mac.replace(/[:\-\.]/g, "").toUpperCase();
  return `${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
}

function isValidMac(mac: string) {
  return mac.replace(/[:\-\.]/g, "").length >= 6;
}

export function useMacVendor(mac: string | null | undefined) {
  const oui = mac && isValidMac(mac) ? normalizeOui(mac) : null;
  const [vendor, setVendor] = useState<string | null>(oui ? (cache.get(oui) ?? null) : null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!oui) { setVendor(null); return; }
    if (cache.has(oui)) { setVendor(cache.get(oui) ?? null); return; }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/mac-vendor/${encodeURIComponent(oui)}`)
      .then((res) => res.ok ? res.json() : { vendor: null })
      .then((data: { vendor: string | null }) => {
        if (cancelled) return;
        const result = data.vendor?.trim() || null;
        cache.set(oui, result);
        setVendor(result);
      })
      .catch(() => {
        if (!cancelled) { cache.set(oui, null); setVendor(null); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [oui]);

  return { vendor, loading };
}
