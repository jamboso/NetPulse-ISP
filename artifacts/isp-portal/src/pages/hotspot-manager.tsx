import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useGetRouter } from "@workspace/api-client-react";
import {
  ArrowLeft, Wifi, Plus, Trash2, RefreshCw, UserX, CheckCircle2,
  AlertTriangle, Loader2, Info, Zap, ExternalLink, Pencil, Copy, Clock, Globe,
  Download, Radio, Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type AnyRecord = Record<string, any>;

function apiBase() { return import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""; }
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${apiBase()}/api${path}`, {
    headers: { "Content-Type": "application/json" }, ...opts,
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
  return res.json();
}

function portalUrl(routerId: number): string {
  const base = window.location.origin + (import.meta.env.BASE_URL ?? "");
  return `${base.replace(/\/$/, "")}/hotspot/${routerId}`;
}

function fmtDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hr`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)} day${minutes >= 2880 ? "s" : ""}`;
  return `${Math.round(minutes / 10080)} wk`;
}

function fmtSpeed(kbps: number | null) {
  if (!kbps || kbps <= 0) return "Unlimited";
  return kbps >= 1024 ? `${Math.round(kbps / 1024)} Mbps` : `${kbps} Kbps`;
}

function fmtData(mb: number | null) {
  if (!mb) return "Unlimited";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function fmtUptime(s: string) {
  return s?.replace(/(\d+)w/, "$1w ").replace(/(\d+)d/, "$1d ").replace(/(\d+)h/, "$1h ").replace(/(\d+)m(\s|$)/, "$1m").trim() || "—";
}

const STATUS_COLOR: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  expired: "bg-gray-100 text-gray-500",
  failed: "bg-red-50 text-red-600 border-red-200",
};

interface Package {
  id: number; routerId: number; name: string; description: string | null;
  durationMinutes: number; dataLimitMb: number | null;
  downloadSpeedKbps: number | null; uploadSpeedKbps: number | null;
  price: string; currency: string; isActive: boolean; sortOrder: number;
}
interface Voucher {
  id: number; username: string; phone: string; status: string;
  amountPaid: string | null; mpesaRef: string | null;
  expiresAt: string | null; activatedAt: string | null; createdAt: string;
}

const emptyPkg = {
  name: "", description: "", durationMinutes: "60", dataLimitMb: "",
  downloadSpeedKbps: "", uploadSpeedKbps: "", price: "", currency: "KES", sortOrder: "0",
};

export default function HotspotManager() {
  const { id } = useParams();
  const routerId = parseInt(id ?? "0");
  const { data: routerMeta } = useGetRouter(routerId);

  const [hsStatus, setHsStatus] = useState<AnyRecord | null>(null);
  const [packages, setPackages] = useState<Package[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [activeSessions, setActiveSessions] = useState<AnyRecord[]>([]);
  const [rosUsers, setRosUsers] = useState<AnyRecord[]>([]);
  const [ifaces, setIfaces] = useState<AnyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusErr, setStatusErr] = useState("");

  const [setupForm, setSetupForm] = useState({
    interface: "", portalBaseUrl: "", poolName: "hs-pool",
    poolRange: "10.5.0.1-10.5.15.254", addressPool: "10.5.0.0/20",
    gateway: "10.5.0.1", dnsServers: "8.8.8.8,1.1.1.1",
    serverProfileName: "hs-profile", serverName: "hotspot1",
    cookieTimeout: "3d", sessionTimeout: "1h", idleTimeout: "10m",
  });
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupResult, setSetupResult] = useState<{ steps: string[]; errors: string[]; success: boolean } | null>(null);

  const [pkgDialog, setPkgDialog] = useState<{ open: boolean; editing?: Package }>({ open: false });
  const [pkgForm, setPkgForm] = useState(emptyPkg);
  const [pkgSaving, setPkgSaving] = useState(false);
  const [pkgErr, setPkgErr] = useState("");

  const [kickingSession, setKickingSession] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [activeRefreshing, setActiveRefreshing] = useState(false);

  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setStatusErr("");
    try {
      const [st, pkgs, vou, ifl] = await Promise.all([
        apiFetch(`/routers/${routerId}/ros/hotspot/status`).catch(() => ({ error: "unreachable" })),
        apiFetch(`/routers/${routerId}/hotspot/packages`),
        apiFetch(`/routers/${routerId}/hotspot/vouchers`),
        apiFetch(`/routers/${routerId}/ros/pppoe/interfaces`).catch(() => []),
      ]);
      setHsStatus(st);
      setPackages(Array.isArray(pkgs) ? pkgs : []);
      setVouchers(Array.isArray(vou) ? vou : []);
      setIfaces(Array.isArray(ifl) ? ifl : []);
      setActiveSessions(Array.isArray(st?.activeSessions) ? st.activeSessions : []);
      if (Array.isArray(ifl) && ifl.length > 0 && !setupForm.interface) {
        const wlan = ifl.find((i: AnyRecord) => i.type === "wlan" || i.name?.startsWith("wlan"));
        const bridge = ifl.find((i: AnyRecord) => i.type === "bridge");
        setSetupForm(f => ({ ...f, interface: wlan?.name ?? bridge?.name ?? (ifl[0]?.name ?? ""), portalBaseUrl: window.location.origin }));
      }
    } catch (e: any) {
      setStatusErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [routerId]);

  useEffect(() => { load(); }, [load]);

  async function loadRosUsers() {
    try {
      const u = await apiFetch(`/routers/${routerId}/ros/hotspot/users`);
      setRosUsers(Array.isArray(u) ? u : []);
    } catch {}
  }

  async function handleSetup() {
    if (!setupForm.interface) { alert("Select an interface."); return; }
    setSetupRunning(true); setSetupResult(null);
    try {
      const res = await apiFetch(`/routers/${routerId}/ros/hotspot/setup`, {
        method: "POST", body: JSON.stringify(setupForm),
      });
      setSetupResult(res);
      if (res.success) load();
    } catch (e: any) {
      setSetupResult({ success: false, steps: [], errors: [e.message] });
    } finally { setSetupRunning(false); }
  }

  async function refreshActive() {
    setActiveRefreshing(true);
    try {
      const a = await apiFetch(`/routers/${routerId}/ros/hotspot/active`);
      setActiveSessions(Array.isArray(a) ? a : []);
    } catch {} finally { setActiveRefreshing(false); }
  }

  function openAddPkg() {
    setPkgForm(emptyPkg); setPkgErr(""); setPkgDialog({ open: true });
  }
  function openEditPkg(pkg: Package) {
    setPkgForm({
      name: pkg.name, description: pkg.description ?? "",
      durationMinutes: String(pkg.durationMinutes),
      dataLimitMb: pkg.dataLimitMb != null ? String(pkg.dataLimitMb) : "",
      downloadSpeedKbps: pkg.downloadSpeedKbps != null ? String(pkg.downloadSpeedKbps) : "",
      uploadSpeedKbps: pkg.uploadSpeedKbps != null ? String(pkg.uploadSpeedKbps) : "",
      price: pkg.price, currency: pkg.currency, sortOrder: String(pkg.sortOrder),
    });
    setPkgErr(""); setPkgDialog({ open: true, editing: pkg });
  }

  async function savePkg() {
    if (!pkgForm.name || !pkgForm.durationMinutes || !pkgForm.price) {
      setPkgErr("Name, duration, and price are required."); return;
    }
    setPkgSaving(true); setPkgErr("");
    const payload = {
      name: pkgForm.name, description: pkgForm.description || null,
      durationMinutes: parseInt(pkgForm.durationMinutes),
      dataLimitMb: pkgForm.dataLimitMb ? parseInt(pkgForm.dataLimitMb) : null,
      downloadSpeedKbps: pkgForm.downloadSpeedKbps ? parseInt(pkgForm.downloadSpeedKbps) : null,
      uploadSpeedKbps: pkgForm.uploadSpeedKbps ? parseInt(pkgForm.uploadSpeedKbps) : null,
      price: pkgForm.price, currency: pkgForm.currency, sortOrder: parseInt(pkgForm.sortOrder) || 0,
    };
    try {
      if (pkgDialog.editing) {
        await apiFetch(`/routers/${routerId}/hotspot/packages/${pkgDialog.editing.id}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
      } else {
        await apiFetch(`/routers/${routerId}/hotspot/packages`, {
          method: "POST", body: JSON.stringify(payload),
        });
      }
      setPkgDialog({ open: false });
      const pkgs = await apiFetch(`/routers/${routerId}/hotspot/packages`);
      setPackages(Array.isArray(pkgs) ? pkgs : []);
    } catch (e: any) { setPkgErr(e.message); } finally { setPkgSaving(false); }
  }

  async function deletePkg(id: number) {
    if (!confirm("Delete this package? Existing vouchers won't be affected.")) return;
    await apiFetch(`/routers/${routerId}/hotspot/packages/${id}`, { method: "DELETE" });
    setPackages(prev => prev.filter(p => p.id !== id));
  }

  async function handleKickSession(sessionId: string) {
    if (!confirm("Disconnect this hotspot session?")) return;
    setKickingSession(sessionId);
    try {
      await apiFetch(`/routers/${routerId}/ros/hotspot/active/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      setActiveSessions(prev => prev.filter(s => s[".id"] !== sessionId));
    } catch (e: any) { alert(e.message); } finally { setKickingSession(null); }
  }

  async function handleDeleteRosUser(rosId: string) {
    if (!confirm("Remove this hotspot user from RouterOS?")) return;
    setDeletingUser(rosId);
    try {
      await apiFetch(`/routers/${routerId}/ros/hotspot/users/${encodeURIComponent(rosId)}`, { method: "DELETE" });
      setRosUsers(prev => prev.filter(u => u[".id"] !== rosId));
    } catch (e: any) { alert(e.message); } finally { setDeletingUser(null); }
  }

  function copyPortalUrl() {
    navigator.clipboard.writeText(portalUrl(routerId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const servers = Array.isArray(hsStatus?.servers) ? hsStatus.servers as AnyRecord[] : [];
  const isConfigured = servers.length > 0;

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="icon" asChild className="h-8 w-8 shrink-0">
          <Link href={`/network/routers/${routerId}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">Hotspot Manager</h1>
            <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200 text-xs">
              {routerMeta?.name ?? `Router #${routerId}`}
            </Badge>
            {isConfigured && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> {servers.length} server{servers.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-500">Enterprise hotspot, M-Pesa payments &amp; captive portal management</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5 shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {statusErr && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{statusErr}</p>
        </div>
      )}

      {/* Portal URL banner */}
      <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4 flex items-center gap-4 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-0.5">Captive Portal URL</p>
          <p className="text-sm font-mono text-gray-800 truncate">{portalUrl(routerId)}</p>
          <p className="text-xs text-gray-500 mt-0.5">Set this as the login-page in your hotspot profile, or share it with WiFi users</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copyPortalUrl}>
            <Copy className="w-3.5 h-3.5" /> {copied ? "Copied!" : "Copy"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <a href={`/hotspot/${routerId}`} target="_blank" rel="noreferrer">
              <ExternalLink className="w-3.5 h-3.5" /> Preview
            </a>
          </Button>
        </div>
      </div>

      <Tabs defaultValue={isConfigured ? "sessions" : "setup"} className="w-full">
        <TabsList className="bg-gray-100 flex-wrap h-auto">
          <TabsTrigger value="setup" className="data-[state=active]:bg-white gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Auto-Setup
          </TabsTrigger>
          <TabsTrigger value="packages" className="data-[state=active]:bg-white gap-1.5">
            Packages <Badge variant="secondary" className="ml-1 text-xs px-1">{packages.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="sessions" className="data-[state=active]:bg-white gap-1.5">
            <Radio className="w-3.5 h-3.5" /> Active Sessions <Badge variant="secondary" className="ml-1 text-xs px-1">{activeSessions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-white gap-1.5" onClick={loadRosUsers}>
            RouterOS Users <Badge variant="secondary" className="ml-1 text-xs px-1">{rosUsers.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="vouchers" className="data-[state=active]:bg-white gap-1.5">
            Vouchers <Badge variant="secondary" className="ml-1 text-xs px-1">{vouchers.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── AUTO SETUP ── */}
        <TabsContent value="setup" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-1">Enterprise Hotspot Auto-Configuration</h3>
              <p className="text-sm text-gray-500 mb-5">
                Creates IP pool, gateway address, hotspot server profiles (1/2/5/10 Mbps tiers), walled garden for M-Pesa, and configures the captive portal redirect.
              </p>
              <div className="space-y-4">
                <div>
                  <Label>Interface</Label>
                  <select value={setupForm.interface}
                    onChange={e => setSetupForm(f => ({ ...f, interface: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500">
                    <option value="">— Select interface —</option>
                    {ifaces.map((i: AnyRecord) => (
                      <option key={i.name} value={i.name}>{i.name} ({i.type})</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Typically the WiFi (wlan) or bridge interface for your hotspot network</p>
                </div>
                <div>
                  <Label>Portal Base URL</Label>
                  <Input className="mt-1" value={setupForm.portalBaseUrl}
                    onChange={e => setSetupForm(f => ({ ...f, portalBaseUrl: e.target.value }))}
                    placeholder="https://your-app.replit.app" />
                  <p className="text-xs text-gray-400 mt-1">Your app's public URL — pre-filled from current location</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Gateway IP</Label>
                    <Input className="mt-1" value={setupForm.gateway} onChange={e => setSetupForm(f => ({ ...f, gateway: e.target.value }))} />
                  </div>
                  <div><Label>Network CIDR</Label>
                    <Input className="mt-1" value={setupForm.addressPool} onChange={e => setSetupForm(f => ({ ...f, addressPool: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>DHCP Pool Range</Label>
                  <Input className="mt-1" value={setupForm.poolRange} onChange={e => setSetupForm(f => ({ ...f, poolRange: e.target.value }))} />
                  <p className="text-xs text-gray-400 mt-1">Supports up to 4,095 simultaneous users</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>DNS Servers</Label>
                    <Input className="mt-1" value={setupForm.dnsServers} onChange={e => setSetupForm(f => ({ ...f, dnsServers: e.target.value }))} />
                  </div>
                  <div><Label>Cookie Timeout</Label>
                    <Input className="mt-1" value={setupForm.cookieTimeout} onChange={e => setSetupForm(f => ({ ...f, cookieTimeout: e.target.value }))} />
                  </div>
                </div>
                <Button onClick={handleSetup} disabled={setupRunning || !setupForm.interface}
                  className="w-full bg-violet-600 hover:bg-violet-700 text-white gap-2 mt-2">
                  {setupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {setupRunning ? "Configuring RouterOS…" : "Configure Hotspot Server"}
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {setupResult && (
                <div className={`rounded-xl border p-5 ${setupResult.success ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {setupResult.success ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-yellow-600" />}
                    <h4 className="font-semibold text-sm">{setupResult.success ? "Hotspot Configured!" : "Completed with warnings"}</h4>
                  </div>
                  <div className="space-y-1 font-mono text-xs max-h-64 overflow-y-auto">
                    {setupResult.steps.map((s, i) => <div key={i} className="text-green-800">{s}</div>)}
                    {setupResult.errors.map((e, i) => <div key={i} className="text-red-700">{e}</div>)}
                  </div>
                </div>
              )}

              {isConfigured && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h4 className="font-semibold text-sm text-gray-900 mb-3">Hotspot Servers</h4>
                  {servers.map((s: AnyRecord, i: number) => (
                    <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded-lg mb-1">
                      <div>
                        <span className="font-medium">{s.name}</span>
                        <span className="text-gray-500 text-xs ml-2">on {s.interface}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{activeSessions.length} active</span>
                        <Badge variant="outline" className={`text-xs ${s.disabled === "true" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                          {s.disabled === "true" ? "disabled" : "running"}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex gap-2">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-700 space-y-1">
                    <p className="font-semibold">Enterprise features included:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-blue-600">
                      <li>Speed-tier profiles: 1/2/5/10 Mbps + Unlimited</li>
                      <li>MAC-address auto-login after purchase</li>
                      <li>Walled garden for M-Pesa &amp; Safaricom APIs</li>
                      <li>Cookie-based session persistence</li>
                      <li>Idle &amp; keepalive timeouts</li>
                      <li>External captive portal redirect</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── PACKAGES ── */}
        <TabsContent value="packages" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
            {packages.map(pkg => (
              <div key={pkg.id} className="bg-white rounded-xl border border-gray-200 p-5 relative">
                {!pkg.isActive && <div className="absolute top-3 right-3"><Badge variant="outline" className="text-xs bg-gray-100 text-gray-500">Hidden</Badge></div>}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="font-semibold text-gray-900">{pkg.name}</h3>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-blue-600" onClick={() => openEditPkg(pkg)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" onClick={() => deletePkg(pkg.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {pkg.description && <p className="text-xs text-gray-500 mb-3">{pkg.description}</p>}
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
                    <Clock className="w-3 h-3" /> {fmtDuration(pkg.durationMinutes)}
                  </span>
                  <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
                    <Download className="w-3 h-3" /> {fmtSpeed(pkg.downloadSpeedKbps)}
                  </span>
                  <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
                    <Globe className="w-3 h-3" /> {fmtData(pkg.dataLimitMb)}
                  </span>
                </div>
                <div className="text-2xl font-black text-gray-900">
                  {pkg.currency === "KES" ? "KSh " : pkg.currency + " "}{Number(pkg.price).toLocaleString()}
                </div>
              </div>
            ))}
            <button onClick={openAddPkg}
              className="border-2 border-dashed border-gray-200 rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-violet-400 hover:text-violet-500 transition-colors min-h-[160px]">
              <Plus className="w-8 h-8" />
              <span className="text-sm font-medium">Add Package</span>
            </button>
          </div>
          {packages.length === 0 && (
            <div className="bg-violet-50 border border-violet-200 rounded-xl p-6 text-center">
              <Wifi className="w-10 h-10 text-violet-300 mx-auto mb-3" />
              <p className="text-violet-700 font-medium mb-1">No packages yet</p>
              <p className="text-violet-500 text-sm">Add your first package — it will appear on the captive portal for customers to purchase.</p>
            </div>
          )}
        </TabsContent>

        {/* ── ACTIVE SESSIONS ── */}
        <TabsContent value="sessions" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">{activeSessions.length} Active Sessions</h3>
              <Button variant="outline" size="sm" onClick={refreshActive} className="gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${activeRefreshing ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>MAC Address</TableHead>
                      <TableHead>Uptime</TableHead>
                      <TableHead className="text-right">TX Bytes</TableHead>
                      <TableHead className="text-right">RX Bytes</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeSessions.length > 0 ? activeSessions.map((s: AnyRecord, idx: number) => (
                      <TableRow key={idx} className="hover:bg-gray-50/60">
                        <TableCell className="font-medium text-sm">{s.user || s.name}</TableCell>
                        <TableCell className="font-mono text-xs">{s.address || "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-gray-500">{s["mac-address"] || "—"}</TableCell>
                        <TableCell className="text-xs">{fmtUptime(s.uptime)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-blue-700">
                          {s["bytes-out"] ? (parseInt(s["bytes-out"]) / 1e6).toFixed(2) + " MB" : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-700">
                          {s["bytes-in"] ? (parseInt(s["bytes-in"]) / 1e6).toFixed(2) + " MB" : "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600"
                            disabled={kickingSession === s[".id"]}
                            onClick={() => handleKickSession(s[".id"])}>
                            {kickingSession === s[".id"] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={7} className="h-24 text-center text-gray-400 text-sm">No active hotspot sessions</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── ROS USERS ── */}
        <TabsContent value="users" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">RouterOS Hotspot Users ({rosUsers.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Uptime Limit</TableHead>
                    <TableHead>Bytes Limit</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rosUsers.length > 0 ? rosUsers.map((u: AnyRecord, idx: number) => (
                    <TableRow key={idx} className={`hover:bg-gray-50/60 ${u.disabled === "true" ? "opacity-40" : ""}`}>
                      <TableCell className="font-mono text-xs font-medium">{u.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs bg-purple-50 text-purple-700">{u.profile || "default"}</Badge></TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{u["mac-address"] || "—"}</TableCell>
                      <TableCell className="text-xs">{u["limit-uptime"] || "none"}</TableCell>
                      <TableCell className="text-xs">{u["limit-bytes-total"] ? `${(parseInt(u["limit-bytes-total"]) / 1e6).toFixed(0)} MB` : "none"}</TableCell>
                      <TableCell className="text-xs text-gray-400 max-w-[160px] truncate">{u.comment || "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600"
                          disabled={deletingUser === u[".id"]}
                          onClick={() => handleDeleteRosUser(u[".id"])}>
                          {deletingUser === u[".id"] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="h-20 text-center text-gray-400 text-sm">
                      No hotspot users — users are created automatically when customers pay via M-Pesa
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── VOUCHERS ── */}
        <TabsContent value="vouchers" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Voucher History ({vouchers.length})</h3>
              <div className="flex gap-2 text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Active</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Pending</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> Expired/Failed</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Phone</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>M-Pesa Ref</TableHead>
                    <TableHead>Activated</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vouchers.length > 0 ? vouchers.map((v, idx) => (
                    <TableRow key={idx} className="hover:bg-gray-50/60">
                      <TableCell className="font-mono text-sm">{v.phone}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-600">{v.username}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs capitalize ${STATUS_COLOR[v.status] ?? "bg-gray-50 text-gray-500"}`}>
                          {v.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm font-semibold">
                        {v.amountPaid ? `KSh ${Number(v.amountPaid).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-green-700">{v.mpesaRef || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {v.activatedAt ? new Date(v.activatedAt).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-xs text-gray-500">
                        {v.expiresAt ? new Date(v.expiresAt).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="h-24 text-center text-gray-400 text-sm">
                      No vouchers yet. Vouchers are created when customers pay via the captive portal.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Package Dialog */}
      <Dialog open={pkgDialog.open} onOpenChange={o => setPkgDialog({ open: o })}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{pkgDialog.editing ? "Edit Package" : "Add Package"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Package Name</Label>
              <Input className="mt-1" value={pkgForm.name} onChange={e => setPkgForm(f => ({ ...f, name: e.target.value }))} placeholder="Daily 1GB" />
            </div>
            <div><Label>Description</Label>
              <Input className="mt-1" value={pkgForm.description} onChange={e => setPkgForm(f => ({ ...f, description: e.target.value }))} placeholder="Great for casual browsing" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Duration (minutes)</Label>
                <Input className="mt-1" type="number" value={pkgForm.durationMinutes} onChange={e => setPkgForm(f => ({ ...f, durationMinutes: e.target.value }))} placeholder="1440" />
                <p className="text-xs text-gray-400 mt-0.5">1440 = 1 day, 10080 = 1 week</p>
              </div>
              <div><Label>Price (KES)</Label>
                <Input className="mt-1" type="number" value={pkgForm.price} onChange={e => setPkgForm(f => ({ ...f, price: e.target.value }))} placeholder="50" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Download Speed (Kbps)</Label>
                <Input className="mt-1" type="number" value={pkgForm.downloadSpeedKbps} onChange={e => setPkgForm(f => ({ ...f, downloadSpeedKbps: e.target.value }))} placeholder="5120 (5 Mbps)" />
              </div>
              <div><Label>Upload Speed (Kbps)</Label>
                <Input className="mt-1" type="number" value={pkgForm.uploadSpeedKbps} onChange={e => setPkgForm(f => ({ ...f, uploadSpeedKbps: e.target.value }))} placeholder="2048" />
              </div>
            </div>
            <div><Label>Data Limit (MB, 0=unlimited)</Label>
              <Input className="mt-1" type="number" value={pkgForm.dataLimitMb} onChange={e => setPkgForm(f => ({ ...f, dataLimitMb: e.target.value }))} placeholder="1024 (1 GB)" />
            </div>
            {pkgErr && <p className="text-sm text-red-600">{pkgErr}</p>}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setPkgDialog({ open: false })}>Cancel</Button>
              <Button className="flex-1 bg-violet-600 hover:bg-violet-700 text-white" disabled={pkgSaving} onClick={savePkg}>
                {pkgSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : pkgDialog.editing ? "Save Changes" : "Add Package"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
