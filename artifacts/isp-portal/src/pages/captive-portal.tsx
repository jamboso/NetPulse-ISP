import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearch } from "wouter";
import { Wifi, CheckCircle2, AlertCircle, Loader2, Smartphone, Clock, Zap, Download, Upload, Globe } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Package {
  id: number;
  name: string;
  description: string | null;
  durationMinutes: number;
  dataLimitMb: number | null;
  downloadSpeedKbps: number | null;
  uploadSpeedKbps: number | null;
  price: string;
  currency: string;
  sortOrder: number;
}

interface RouterInfo { id: number; name: string; location: string | null; }
type Stage = "packages" | "phone" | "paying" | "success" | "error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)} day${minutes >= 2880 ? "s" : ""}`;
  return `${Math.round(minutes / 10080)} week${minutes >= 20160 ? "s" : ""}`;
}

function formatSpeed(kbps: number | null): string {
  if (!kbps || kbps <= 0) return "Unlimited";
  if (kbps >= 1024) return `${Math.round(kbps / 1024)} Mbps`;
  return `${kbps} Kbps`;
}

function formatData(mb: number | null): string {
  if (!mb) return "Unlimited";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function apiBase() {
  return import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
}

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${apiBase()}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
}

// ── Package Card ──────────────────────────────────────────────────────────────
function PackageCard({
  pkg, selected, onSelect, popular,
}: {
  pkg: Package; selected: boolean; onSelect: () => void; popular: boolean;
}) {
  const price = Number(pkg.price);
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-2xl border-2 p-5 transition-all duration-200 relative overflow-hidden
        ${selected
          ? "border-green-400 bg-white/20 shadow-xl shadow-green-500/20 scale-[1.02]"
          : "border-white/20 bg-white/10 hover:border-white/40 hover:bg-white/15"
        }`}
    >
      {popular && (
        <div className="absolute top-0 right-0 bg-gradient-to-l from-green-400 to-emerald-500 text-xs font-bold text-white px-3 py-1 rounded-bl-xl">
          POPULAR
        </div>
      )}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-bold text-white text-lg leading-tight">{pkg.name}</h3>
          {pkg.description && <p className="text-white/60 text-xs mt-0.5">{pkg.description}</p>}
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-black text-white">
            {pkg.currency === "KES" ? "KSh " : pkg.currency + " "}{price.toLocaleString()}
          </div>
          <div className="text-white/50 text-xs">one time</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <span className="flex items-center gap-1.5 text-xs text-white/80 bg-white/10 rounded-full px-3 py-1">
          <Clock className="w-3 h-3" /> {formatDuration(pkg.durationMinutes)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-white/80 bg-white/10 rounded-full px-3 py-1">
          <Download className="w-3 h-3" /> {formatSpeed(pkg.downloadSpeedKbps)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-white/80 bg-white/10 rounded-full px-3 py-1">
          <Globe className="w-3 h-3" /> {formatData(pkg.dataLimitMb)}
        </span>
      </div>
      {selected && (
        <div className="absolute bottom-3 right-3">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
        </div>
      )}
    </button>
  );
}

// ── Main Portal ───────────────────────────────────────────────────────────────
export default function CaptivePortal() {
  const { routerId } = useParams();
  const searchStr = useSearch();
  const searchParams = new URLSearchParams(searchStr);
  const macFromRouter = searchParams.get("mac") ?? searchParams.get("id") ?? "";
  const ipFromRouter = searchParams.get("ip") ?? "";
  const linkLogin = searchParams.get("link-login") ?? "";

  const [info, setInfo] = useState<RouterInfo | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<Stage>("packages");
  const [selected, setSelected] = useState<Package | null>(null);
  const [phone, setPhone] = useState("");
  const [phoneErr, setPhoneErr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voucherId, setVoucherId] = useState<number | null>(null);
  const [checkoutId, setCheckoutId] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [voucher, setVoucher] = useState<{ username?: string; password?: string; expiresAt?: string; status: string } | null>(null);
  const [errMsg, setErrMsg] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch(`/hotspot/${routerId}/info`),
      apiFetch(`/hotspot/${routerId}/packages`),
    ]).then(([i, p]) => {
      setInfo(i);
      setPackages(Array.isArray(p) ? p : []);
      if (Array.isArray(p) && p.length > 0) setSelected(p[0]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [routerId]);

  const startPoll = useCallback((vid: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts++;
      try {
        const v = await apiFetch(`/hotspot/${routerId}/voucher/${vid}`);
        if (v.status === "active") {
          clearInterval(pollRef.current!);
          setVoucher(v);
          setStage("success");
          // Start countdown if we know expiry
        } else if (v.status === "failed" || attempts > 40) {
          clearInterval(pollRef.current!);
          setErrMsg(v.status === "failed" ? "Payment was declined or timed out." : "Could not confirm payment. Please contact staff.");
          setStage("error");
        }
      } catch {}
    }, 3000);
  }, [routerId]);

  useEffect(() => {
    if (stage === "paying") {
      setCountdown(120);
      countdownRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { clearInterval(countdownRef.current!); return 0; }
          return c - 1;
        });
      }, 1000);
    }
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [stage]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  async function handlePay() {
    const clean = phone.replace(/\s/g, "").replace(/^0/, "254").replace(/^\+/, "");
    if (!/^254[17]\d{8}$/.test(clean)) {
      setPhoneErr("Enter a valid Safaricom or Airtel Kenya number (07xx or 01xx)");
      return;
    }
    if (!selected) return;
    setPhoneErr("");
    setSubmitting(true);
    try {
      const data = await apiFetch(`/hotspot/${routerId}/pay`, {
        method: "POST",
        body: JSON.stringify({
          packageId: selected.id,
          phone: clean,
          mac: macFromRouter || undefined,
          ip: ipFromRouter || undefined,
        }),
      });
      if (data.error) { setErrMsg(data.error); setStage("error"); return; }
      setVoucherId(data.voucherId);
      setCheckoutId(data.checkoutRequestId ?? "");
      setStage("paying");
      startPoll(data.voucherId);
    } catch (e: any) {
      setErrMsg("Failed to connect to payment server. Try again.");
      setStage("error");
    } finally {
      setSubmitting(false);
    }
  }

  // Redirect into hotspot on success (RouterOS link-login)
  function handleConnect() {
    if (linkLogin && voucher?.username) {
      const loginUrl = `${linkLogin}?username=${encodeURIComponent(voucher.username)}&password=${encodeURIComponent(voucher.password ?? "")}`;
      window.location.href = loginUrl;
    }
  }

  const popularIdx = packages.length > 1 ? Math.floor(packages.length / 2) : 0;

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col">
      {/* Ambient glow blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-blue-900/10 rounded-full blur-3xl" />
      </div>

      <div className="relative flex-1 flex flex-col items-center px-4 py-8 max-w-lg mx-auto w-full">
        {/* Header */}
        <div className="text-center mb-8 w-full">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl shadow-2xl shadow-blue-500/30 mb-4">
            <Wifi className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight">
            {loading ? "Wi-Fi Portal" : (info?.name ?? "Wi-Fi Portal")}
          </h1>
          {info?.location && (
            <p className="text-white/50 text-sm mt-1">{info.location}</p>
          )}
          <p className="text-white/40 text-xs mt-2">
            High-speed internet — Pay with M-Pesa
          </p>
        </div>

        {/* ── Stage: loading ── */}
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
          </div>
        )}

        {/* ── Stage: packages ── */}
        {!loading && stage === "packages" && (
          <div className="w-full space-y-4 flex-1">
            <h2 className="text-white/70 text-sm font-semibold uppercase tracking-wider text-center mb-2">Choose Your Plan</h2>
            {packages.length === 0 ? (
              <div className="text-center py-16 text-white/40">
                <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No packages available</p>
              </div>
            ) : (
              packages.map((pkg, i) => (
                <PackageCard
                  key={pkg.id}
                  pkg={pkg}
                  selected={selected?.id === pkg.id}
                  onSelect={() => setSelected(pkg)}
                  popular={i === popularIdx}
                />
              ))
            )}
            {packages.length > 0 && (
              <button
                onClick={() => setStage("phone")}
                disabled={!selected}
                className="w-full mt-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl shadow-xl shadow-green-500/30 transition-all duration-200 active:scale-95"
              >
                Continue with M-Pesa →
              </button>
            )}
          </div>
        )}

        {/* ── Stage: phone ── */}
        {stage === "phone" && selected && (
          <div className="w-full flex-1 flex flex-col">
            <button onClick={() => setStage("packages")} className="text-white/50 text-sm mb-6 text-left hover:text-white/80">← Back</button>
            <div className="bg-white/10 border border-white/20 rounded-2xl p-5 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/60 text-xs">Selected Plan</p>
                  <p className="text-white font-bold text-lg">{selected.name}</p>
                  <p className="text-white/50 text-xs mt-0.5">{formatDuration(selected.durationMinutes)} · {formatSpeed(selected.downloadSpeedKbps)}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-black text-white">KSh {Number(selected.price).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="flex-1">
              <label className="block text-white/70 text-sm font-medium mb-2">M-Pesa Phone Number</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2">
                  <Smartphone className="w-5 h-5 text-white/40" />
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setPhoneErr(""); }}
                  placeholder="0712 345 678"
                  className="w-full bg-white/10 border border-white/20 focus:border-green-400 focus:bg-white/15 text-white placeholder-white/30 rounded-2xl py-4 pl-12 pr-4 text-lg outline-none transition-all"
                />
              </div>
              {phoneErr && <p className="text-red-400 text-xs mt-2">{phoneErr}</p>}
              <p className="text-white/40 text-xs mt-2">You'll receive an M-Pesa prompt on this number</p>
            </div>

            <button
              onClick={handlePay}
              disabled={submitting || !phone}
              className="w-full mt-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-lg py-4 rounded-2xl shadow-xl shadow-green-500/30 transition-all duration-200 active:scale-95 flex items-center justify-center gap-3"
            >
              {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {submitting ? "Sending prompt…" : `Pay KSh ${Number(selected.price).toLocaleString()} via M-Pesa`}
            </button>

            <div className="mt-4 flex items-center justify-center gap-2">
              <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/M-PESA_LOGO-01.svg/200px-M-PESA_LOGO-01.svg.png" alt="M-Pesa" className="h-5 object-contain opacity-60" />
              <span className="text-white/30 text-xs">Secured by Safaricom</span>
            </div>
          </div>
        )}

        {/* ── Stage: paying ── */}
        {stage === "paying" && (
          <div className="w-full flex-1 flex flex-col items-center justify-center text-center">
            <div className="relative mb-8">
              <div className="w-28 h-28 rounded-full bg-gradient-to-br from-green-400/20 to-emerald-500/20 border-2 border-green-400/40 flex items-center justify-center animate-pulse">
                <Smartphone className="w-12 h-12 text-green-400" />
              </div>
              <div className="absolute -bottom-2 -right-2 bg-blue-500 rounded-full p-1.5">
                <Loader2 className="w-5 h-5 text-white animate-spin" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Check Your Phone</h2>
            <p className="text-white/60 text-sm mb-6 max-w-xs">
              An M-Pesa payment request has been sent to your phone.<br />
              Enter your PIN to complete the payment.
            </p>
            <div className="bg-white/10 border border-white/20 rounded-2xl px-8 py-4 mb-6">
              <p className="text-white/50 text-xs mb-1">Amount to Pay</p>
              <p className="text-4xl font-black text-white">KSh {Number(selected?.price ?? 0).toLocaleString()}</p>
              <p className="text-white/40 text-xs mt-1">for {selected?.name}</p>
            </div>
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Clock className="w-4 h-4" />
              <span>Waiting for confirmation… {countdown > 0 ? `${countdown}s` : ""}</span>
            </div>
            <p className="text-white/30 text-xs mt-4">Do not close this page</p>
          </div>
        )}

        {/* ── Stage: success ── */}
        {stage === "success" && voucher && (
          <div className="w-full flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-2xl shadow-green-500/40 mb-6">
              <CheckCircle2 className="w-12 h-12 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">Payment Confirmed!</h2>
            <p className="text-white/60 text-sm mb-8">Your internet access is ready</p>

            <div className="w-full bg-white/10 border border-white/20 rounded-2xl p-6 mb-6 text-left space-y-4">
              <div>
                <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-1">Username</p>
                <p className="text-white font-mono text-xl font-bold tracking-widest">{voucher.username}</p>
              </div>
              <div className="border-t border-white/10" />
              <div>
                <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-1">Password</p>
                <p className="text-white font-mono text-xl font-bold tracking-widest">{voucher.password}</p>
              </div>
              {voucher.expiresAt && (
                <>
                  <div className="border-t border-white/10" />
                  <div>
                    <p className="text-white/50 text-xs font-medium uppercase tracking-wider mb-1">Expires</p>
                    <p className="text-white/80 text-sm">{new Date(voucher.expiresAt).toLocaleString()}</p>
                  </div>
                </>
              )}
            </div>

            <p className="text-white/40 text-xs mb-6">
              {linkLogin ? "Tap Connect to start browsing, or use the credentials above in the login form." : "Use the credentials above to log in to the Wi-Fi network."}
            </p>

            {linkLogin ? (
              <button
                onClick={handleConnect}
                className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-white font-bold text-lg py-4 rounded-2xl shadow-xl transition-all active:scale-95"
              >
                <Zap className="inline w-5 h-5 mr-2" />
                Connect Now
              </button>
            ) : (
              <button
                onClick={() => { setStage("packages"); setVoucher(null); setPhone(""); setSelected(packages[0] ?? null); }}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold py-3 rounded-2xl transition-all"
              >
                Buy Another Plan
              </button>
            )}
          </div>
        )}

        {/* ── Stage: error ── */}
        {stage === "error" && (
          <div className="w-full flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full bg-red-500/20 border-2 border-red-400/40 flex items-center justify-center mb-6">
              <AlertCircle className="w-12 h-12 text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Payment Failed</h2>
            <p className="text-white/60 text-sm mb-8 max-w-xs">{errMsg || "Something went wrong. Please try again."}</p>
            <button
              onClick={() => { setStage("packages"); setErrMsg(""); setPhone(""); }}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold py-4 rounded-2xl"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-white/20 text-xs">
          Powered by <span className="text-white/40 font-semibold">NetPulse ISP Manager</span>
        </div>
      </div>
    </div>
  );
}
