import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetRouter } from "@workspace/api-client-react";
import {
  ArrowLeft, Settings, Plus, Trash2, RefreshCw, UserX,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Info, Zap,
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
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error ?? `HTTP ${res.status}`); }
  return res.json();
}

function fmtUptime(s: string): string { return s?.replace(/(\d+)w/, "$1w ").replace(/(\d+)d/, "$1d ").replace(/(\d+)h/, "$1h ").replace(/(\d+)m(\s|$)/, "$1m") || "—"; }
function fmtBytes(n: string | number): string {
  const v = typeof n === "string" ? parseInt(n) : n;
  if (!v || isNaN(v)) return "0 B";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + " GB";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + " MB";
  return (v / 1e3).toFixed(1) + " KB";
}

export default function PPPoESetup() {
  const { id } = useParams();
  const routerId = parseInt(id ?? "0");
  const { data: routerMeta } = useGetRouter(routerId);

  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [ifaces, setIfaces] = useState<AnyRecord[]>([]);
  const [secrets, setSecrets] = useState<AnyRecord[]>([]);
  const [activeSessions, setActiveSessions] = useState<AnyRecord[]>([]);
  const [profiles, setProfiles] = useState<AnyRecord[]>([]);
  const [statusErr, setStatusErr] = useState("");

  const [setupForm, setSetupForm] = useState({
    interface: "", poolName: "pppoe-pool", poolRange: "10.10.0.1-10.10.15.254",
    serviceName: "pppoe-server", localAddress: "10.10.0.1",
    dnsServers: "8.8.8.8,1.1.1.1",
  });
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupResult, setSetupResult] = useState<{ steps: string[]; errors: string[]; success: boolean } | null>(null);

  const [secretDialog, setSecretDialog] = useState(false);
  const [secretForm, setSecretForm] = useState({ name: "", password: "", profile: "default", service: "pppoe", comment: "" });
  const [secretSaving, setSecretSaving] = useState(false);
  const [secretErr, setSecretErr] = useState("");

  const [profileDialog, setProfileDialog] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: "", downloadKbps: "", uploadKbps: "", sessionTimeout: "0" });
  const [profileSaving, setProfileSaving] = useState(false);

  const [kickingSession, setKickingSession] = useState<string | null>(null);
  const [deletingSecret, setDeletingSecret] = useState<string | null>(null);
  const [activeRefreshing, setActiveRefreshing] = useState(false);

  async function loadStatus() {
    setStatusLoading(true);
    setStatusErr("");
    try {
      const [st, ifList, acts, secs] = await Promise.all([
        apiFetch(`/routers/${routerId}/ros/pppoe/status`),
        apiFetch(`/routers/${routerId}/ros/pppoe/interfaces`),
        apiFetch(`/routers/${routerId}/ros/pppoe/active`),
        apiFetch(`/routers/${routerId}/ros/pppoe/secrets`),
      ]);
      setStatus(st);
      setIfaces(Array.isArray(ifList) ? ifList : []);
      setActiveSessions(Array.isArray(acts) ? acts : []);
      setSecrets(Array.isArray(secs) ? secs : []);
      setProfiles(Array.isArray(st.profiles) ? st.profiles : []);
      if (Array.isArray(ifList) && ifList.length > 0 && !setupForm.interface) {
        const eth = ifList.find((i: AnyRecord) => i.type === "ether");
        if (eth) setSetupForm(f => ({ ...f, interface: eth.name }));
      }
    } catch (e: any) {
      setStatusErr(e.message);
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => { loadStatus(); }, [routerId]);

  async function refreshActive() {
    setActiveRefreshing(true);
    try {
      const acts = await apiFetch(`/routers/${routerId}/ros/pppoe/active`);
      setActiveSessions(Array.isArray(acts) ? acts : []);
    } catch {} finally { setActiveRefreshing(false); }
  }

  async function handleSetup() {
    if (!setupForm.interface) { alert("Select an interface first."); return; }
    setSetupRunning(true);
    setSetupResult(null);
    try {
      const res = await apiFetch(`/routers/${routerId}/ros/pppoe/setup`, {
        method: "POST",
        body: JSON.stringify(setupForm),
      });
      setSetupResult(res);
      if (res.success) loadStatus();
    } catch (e: any) {
      setSetupResult({ success: false, steps: [], errors: [e.message] });
    } finally { setSetupRunning(false); }
  }

  async function handleAddSecret() {
    if (!secretForm.name || !secretForm.password) { setSecretErr("Name and password are required."); return; }
    setSecretSaving(true);
    setSecretErr("");
    try {
      await apiFetch(`/routers/${routerId}/ros/pppoe/secrets`, {
        method: "POST",
        body: JSON.stringify(secretForm),
      });
      setSecretDialog(false);
      setSecretForm({ name: "", password: "", profile: "default", service: "pppoe", comment: "" });
      const secs = await apiFetch(`/routers/${routerId}/ros/pppoe/secrets`);
      setSecrets(Array.isArray(secs) ? secs : []);
    } catch (e: any) { setSecretErr(e.message); } finally { setSecretSaving(false); }
  }

  async function handleDeleteSecret(rosId: string) {
    if (!confirm("Delete this PPPoE user? Their connection will be terminated.")) return;
    setDeletingSecret(rosId);
    try {
      await apiFetch(`/routers/${routerId}/ros/pppoe/secrets/${encodeURIComponent(rosId)}`, { method: "DELETE" });
      setSecrets(prev => prev.filter(s => s[".id"] !== rosId));
    } catch (e: any) { alert(e.message); } finally { setDeletingSecret(null); }
  }

  async function handleKickSession(sessionId: string) {
    if (!confirm("Disconnect this PPPoE session?")) return;
    setKickingSession(sessionId);
    try {
      await apiFetch(`/routers/${routerId}/ros/pppoe/active/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      setActiveSessions(prev => prev.filter(s => s[".id"] !== sessionId));
    } catch (e: any) { alert(e.message); } finally { setKickingSession(null); }
  }

  async function handleAddProfile() {
    if (!profileForm.name) return;
    setProfileSaving(true);
    try {
      await apiFetch(`/routers/${routerId}/ros/pppoe/profiles`, {
        method: "POST",
        body: JSON.stringify({
          name: profileForm.name,
          downloadKbps: parseInt(profileForm.downloadKbps) || 0,
          uploadKbps: parseInt(profileForm.uploadKbps) || 0,
          sessionTimeout: profileForm.sessionTimeout,
        }),
      });
      setProfileDialog(false);
      setProfileForm({ name: "", downloadKbps: "", uploadKbps: "", sessionTimeout: "0" });
      loadStatus();
    } catch (e: any) { alert(e.message); } finally { setProfileSaving(false); }
  }

  const servers = Array.isArray(status?.servers) ? status.servers as AnyRecord[] : [];
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
            <h1 className="text-xl font-bold text-gray-900">PPPoE Server Setup</h1>
            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 text-xs">
              {routerMeta?.name ?? `Router #${routerId}`}
            </Badge>
            {isConfigured && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> {servers.length} server{servers.length > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-500">Enterprise PPPoE server configuration &amp; subscriber management</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadStatus} className="gap-1.5 shrink-0">
          <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {statusErr && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{statusErr}</p>
        </div>
      )}

      <Tabs defaultValue={isConfigured ? "active" : "setup"} className="w-full">
        <TabsList className="bg-gray-100 flex-wrap h-auto">
          <TabsTrigger value="setup" className="data-[state=active]:bg-white gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Auto-Setup
          </TabsTrigger>
          <TabsTrigger value="active" className="data-[state=active]:bg-white gap-1.5">
            Active Sessions <Badge variant="secondary" className="ml-1 text-xs px-1">{activeSessions.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="users" className="data-[state=active]:bg-white gap-1.5">
            PPPoE Users <Badge variant="secondary" className="ml-1 text-xs px-1">{secrets.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="profiles" className="data-[state=active]:bg-white gap-1.5">
            Speed Profiles <Badge variant="secondary" className="ml-1 text-xs px-1">{profiles.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="servers" className="data-[state=active]:bg-white gap-1.5">
            Servers <Badge variant="secondary" className="ml-1 text-xs px-1">{servers.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── SETUP WIZARD ── */}
        <TabsContent value="setup" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-1">Enterprise PPPoE Auto-Configuration</h3>
              <p className="text-sm text-gray-500 mb-6">
                Automatically creates IP pool, PPPoE speed profiles (2/5/10 Mbps + Unlimited), and the PPPoE server on the selected interface.
              </p>
              <div className="space-y-4">
                <div>
                  <Label>Interface</Label>
                  <select
                    value={setupForm.interface}
                    onChange={e => setSetupForm(f => ({ ...f, interface: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Select interface —</option>
                    {ifaces.filter(i => i.type === "ether" || i.type === "vlan" || i.type === "bridge").map((i: AnyRecord) => (
                      <option key={i.name} value={i.name}>{i.name} ({i.type})</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>IP Pool Name</Label>
                    <Input className="mt-1" value={setupForm.poolName} onChange={e => setSetupForm(f => ({ ...f, poolName: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Local Address</Label>
                    <Input className="mt-1" value={setupForm.localAddress} onChange={e => setSetupForm(f => ({ ...f, localAddress: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label>Pool Range</Label>
                  <Input className="mt-1" value={setupForm.poolRange} onChange={e => setSetupForm(f => ({ ...f, poolRange: e.target.value }))} placeholder="10.10.0.1-10.10.15.254" />
                  <p className="text-xs text-gray-400 mt-1">Up to 4,094 simultaneous PPPoE clients</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Service Name</Label>
                    <Input className="mt-1" value={setupForm.serviceName} onChange={e => setSetupForm(f => ({ ...f, serviceName: e.target.value }))} />
                  </div>
                  <div>
                    <Label>DNS Servers</Label>
                    <Input className="mt-1" value={setupForm.dnsServers} onChange={e => setSetupForm(f => ({ ...f, dnsServers: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-start gap-2.5 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-gray-500">
                    {status?.radius?.appConfigured
                      ? "RADIUS authentication is configured in Settings → Network and will be enabled on this router automatically."
                      : <>RADIUS authentication isn&apos;t configured yet. Set a RADIUS Server &amp; Secret in Settings → Network to have it enabled on the router automatically during setup.</>}
                  </span>
                </div>
                <Button onClick={handleSetup} disabled={setupRunning || !setupForm.interface}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white gap-2 mt-2">
                  {setupRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  {setupRunning ? "Configuring…" : "Configure PPPoE Server"}
                </Button>
              </div>
            </div>

            {/* Setup result */}
            <div className="space-y-4">
              {setupResult && (
                <div className={`rounded-xl border p-5 ${setupResult.success ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {setupResult.success
                      ? <CheckCircle2 className="w-5 h-5 text-green-600" />
                      : <AlertTriangle className="w-5 h-5 text-yellow-600" />}
                    <h4 className="font-semibold text-sm">
                      {setupResult.success ? "Configuration Complete" : "Completed with warnings"}
                    </h4>
                  </div>
                  <div className="space-y-1 font-mono text-xs">
                    {setupResult.steps.map((s, i) => <div key={i} className="text-green-800">{s}</div>)}
                    {setupResult.errors.map((e, i) => <div key={i} className="text-red-700">{e}</div>)}
                  </div>
                </div>
              )}

              {/* Current servers info */}
              {servers.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h4 className="font-semibold text-sm text-gray-900 mb-3">Current PPPoE Servers</h4>
                  <div className="space-y-2">
                    {servers.map((s: AnyRecord, i: number) => (
                      <div key={i} className="flex items-center justify-between text-sm p-2 bg-gray-50 rounded-lg">
                        <div>
                          <span className="font-medium text-gray-800">{s.name ?? s["service-name"]}</span>
                          <span className="text-gray-500 text-xs ml-2">on {s.interface}</span>
                        </div>
                        <Badge variant="outline" className={`text-xs ${s.disabled === "true" ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"}`}>
                          {s.disabled === "true" ? "disabled" : "active"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* RADIUS status */}
              {status?.radius && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h4 className="font-semibold text-sm text-gray-900 mb-3">RADIUS Authentication</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <span className="text-gray-700">App RADIUS server configured</span>
                      <Badge variant="outline" className={`text-xs ${status.radius.appConfigured ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                        {status.radius.appConfigured ? "yes" : "not set"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <span className="text-gray-700">Router PPP AAA use-radius</span>
                      <Badge variant="outline" className={`text-xs ${status.radius.aaaUseRadius ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {status.radius.aaaUseRadius ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                    {Array.isArray(status.radius.entries) && status.radius.entries.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {status.radius.entries.map((e: AnyRecord, i: number) => (
                          <div key={i} className="flex items-center justify-between text-xs p-2 bg-gray-50 rounded-lg font-mono">
                            <span>{e.address} ({e.service})</span>
                            <span className="text-gray-400">auth:{e["authentication-port"]} acct:{e["accounting-port"]}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <div className="flex gap-2">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-700 space-y-1">
                    <p className="font-semibold">What gets created:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-blue-600">
                      <li>IP pool with your specified range</li>
                      <li>Speed profiles: 2Mbps, 5Mbps, 10Mbps, Unlimited</li>
                      <li>PPPoE server with CHAP/MSCHAP2 authentication</li>
                      <li>One-session-per-host enforcement</li>
                      {status?.radius?.appConfigured && (
                        <li>RADIUS server entry &amp; PPP AAA (use-radius + accounting) enabled</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── ACTIVE SESSIONS ── */}
        <TabsContent value="active" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">{activeSessions.length} Active PPPoE Sessions</h3>
              <Button variant="outline" size="sm" onClick={refreshActive} className="gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${activeRefreshing ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            {statusLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Username</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Interface</TableHead>
                      <TableHead>Uptime</TableHead>
                      <TableHead className="text-right">TX Bytes</TableHead>
                      <TableHead className="text-right">RX Bytes</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeSessions.length > 0 ? activeSessions.map((s: AnyRecord, idx: number) => (
                      <TableRow key={idx} className="hover:bg-gray-50/60">
                        <TableCell className="font-medium text-sm">{s.name}</TableCell>
                        <TableCell className="font-mono text-xs">{s.address || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{s["caller-id"] || s.interface || "—"}</TableCell>
                        <TableCell className="text-xs">{fmtUptime(s.uptime)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-blue-700">{fmtBytes(s["bytes-out"] ?? s["tx-byte"] ?? 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs text-emerald-700">{fmtBytes(s["bytes-in"] ?? s["rx-byte"] ?? 0)}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600"
                            title="Disconnect session"
                            disabled={kickingSession === s[".id"]}
                            onClick={() => handleKickSession(s[".id"])}>
                            {kickingSession === s[".id"] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow><TableCell colSpan={7} className="h-24 text-center text-gray-400 text-sm">No active sessions</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── PPPoE USERS ── */}
        <TabsContent value="users" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">{secrets.length} PPPoE Users</h3>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                onClick={() => setSecretDialog(true)}>
                <Plus className="w-3.5 h-3.5" /> Add User
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Remote Address</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {secrets.length > 0 ? secrets.map((s: AnyRecord, idx: number) => (
                    <TableRow key={idx} className={`hover:bg-gray-50/60 ${s.disabled === "true" ? "opacity-40" : ""}`}>
                      <TableCell className="font-medium text-sm">{s.name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">{s.service || "pppoe"}</Badge></TableCell>
                      <TableCell className="text-xs text-gray-600">{s.profile || "default"}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{s["remote-address"] || "pool"}</TableCell>
                      <TableCell className="text-xs text-gray-400 max-w-[160px] truncate">{s.comment || "—"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600"
                          disabled={deletingSecret === s[".id"]}
                          onClick={() => handleDeleteSecret(s[".id"])}>
                          {deletingSecret === s[".id"] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={6} className="h-24 text-center text-gray-400 text-sm">
                      No PPPoE users. Add the first one to get started.
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── SPEED PROFILES ── */}
        <TabsContent value="profiles" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">{profiles.length} Speed Profiles</h3>
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                onClick={() => setProfileDialog(true)}>
                <Plus className="w-3.5 h-3.5" /> Add Profile
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Profile Name</TableHead>
                    <TableHead>Rate Limit</TableHead>
                    <TableHead>Local Address</TableHead>
                    <TableHead>Remote Pool</TableHead>
                    <TableHead>Session Timeout</TableHead>
                    <TableHead>DNS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p: AnyRecord, i: number) => (
                    <TableRow key={i} className="hover:bg-gray-50/60">
                      <TableCell className="font-medium text-sm">{p.name}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {p["rate-limit"] ? (
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">{p["rate-limit"]}</Badge>
                        ) : <span className="text-gray-400">none</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{p["local-address"] || "—"}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{p["remote-address"] || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-500">{p["session-timeout"] || "none"}</TableCell>
                      <TableCell className="text-xs text-gray-500">{Array.isArray(p.dns) ? p.dns.join(", ") : (p.dns || "—")}</TableCell>
                    </TableRow>
                  ))}
                  {profiles.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="h-20 text-center text-gray-400 text-sm">No profiles found — run Auto-Setup first</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── SERVERS ── */}
        <TabsContent value="servers" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 text-sm">PPPoE Server Instances</h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Service Name</TableHead>
                    <TableHead>Interface</TableHead>
                    <TableHead>MTU</TableHead>
                    <TableHead>One-session/host</TableHead>
                    <TableHead>Authentication</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {servers.length > 0 ? servers.map((s: AnyRecord, i: number) => (
                    <TableRow key={i} className="hover:bg-gray-50/60">
                      <TableCell><div className={`w-2 h-2 rounded-full ${s.disabled === "true" ? "bg-red-400" : "bg-green-500"}`} /></TableCell>
                      <TableCell className="font-medium text-sm">{s.name ?? s["service-name"]}</TableCell>
                      <TableCell className="text-sm">{s.interface}</TableCell>
                      <TableCell className="font-mono text-xs">{s["max-mtu"] || "1480"}</TableCell>
                      <TableCell className="text-xs">{s["one-session-per-host"] || "no"}</TableCell>
                      <TableCell className="text-xs">{s.authentication || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${s.disabled === "true" ? "bg-red-50 text-red-600 border-red-200" : "bg-green-50 text-green-700 border-green-200"}`}>
                          {s.disabled === "true" ? "disabled" : "active"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={7} className="h-20 text-center text-gray-400 text-sm">No PPPoE servers configured — run Auto-Setup first</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Add Secret Dialog */}
      <Dialog open={secretDialog} onOpenChange={setSecretDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add PPPoE User</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Username</Label><Input className="mt-1" value={secretForm.name} onChange={e => setSecretForm(f => ({ ...f, name: e.target.value }))} placeholder="john.doe" /></div>
              <div><Label>Password</Label><Input className="mt-1" type="password" value={secretForm.password} onChange={e => setSecretForm(f => ({ ...f, password: e.target.value }))} placeholder="••••••••" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Profile</Label>
                <select value={secretForm.profile} onChange={e => setSecretForm(f => ({ ...f, profile: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="default">default</option>
                  {profiles.filter((p: AnyRecord) => p.name !== "default").map((p: AnyRecord) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div><Label>Service</Label>
                <select value={secretForm.service} onChange={e => setSecretForm(f => ({ ...f, service: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option>pppoe</option><option>pptp</option><option>l2tp</option><option>any</option>
                </select>
              </div>
            </div>
            <div><Label>Comment</Label><Input className="mt-1" value={secretForm.comment} onChange={e => setSecretForm(f => ({ ...f, comment: e.target.value }))} placeholder="Optional note" /></div>
            {secretErr && <p className="text-sm text-red-600">{secretErr}</p>}
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setSecretDialog(false)}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" disabled={secretSaving} onClick={handleAddSecret}>
                {secretSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add User"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Profile Dialog */}
      <Dialog open={profileDialog} onOpenChange={setProfileDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Speed Profile</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Profile Name</Label><Input className="mt-1" value={profileForm.name} onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))} placeholder="plan-20mbps" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Download (Kbps)</Label><Input className="mt-1" type="number" value={profileForm.downloadKbps} onChange={e => setProfileForm(f => ({ ...f, downloadKbps: e.target.value }))} placeholder="10240" /></div>
              <div><Label>Upload (Kbps)</Label><Input className="mt-1" type="number" value={profileForm.uploadKbps} onChange={e => setProfileForm(f => ({ ...f, uploadKbps: e.target.value }))} placeholder="5120" /></div>
            </div>
            <div><Label>Session Timeout</Label><Input className="mt-1" value={profileForm.sessionTimeout} onChange={e => setProfileForm(f => ({ ...f, sessionTimeout: e.target.value }))} placeholder="0 = unlimited" /></div>
            <p className="text-xs text-gray-400">Speeds of 0 = unlimited. Rate limit format: upload/download (e.g. 5120k/10240k)</p>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setProfileDialog(false)}>Cancel</Button>
              <Button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white" disabled={profileSaving} onClick={handleAddProfile}>
                {profileSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add Profile"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
