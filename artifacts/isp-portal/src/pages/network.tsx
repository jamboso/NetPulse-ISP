import { useState, useEffect, useCallback, Fragment, useRef } from "react";
import { useMacVendor } from "@/hooks/useMacVendor";
import {
  useListEquipment, useCreateEquipment, useUpdateEquipment, useDeleteEquipment,
  useListIpPools, useCreateIpPool, useUpdateIpPool, useDeleteIpPool,
  useListRouters, useCreateRouter, useUpdateRouter, useDeleteRouter,
  RouterDeviceInputRouterType, RouterDeviceUpdateRouterType,
  EquipmentInput, EquipmentUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { FiberAccessWorkspace } from "@/components/fiber-access-workspace";
import { Link } from "wouter";
import {
  Plus, Server, Route, Wifi, Pencil, Trash2, ChevronDown,
  CheckCircle2, Circle, WrenchIcon, AlertTriangle, LayoutDashboard, FileCode2,
  KeyRound, Shield, Download, X as XIcon, BarChart2, RefreshCw,
  Globe, TrendingUp, Copy, Check, Zap, Loader2, Radio, RotateCcw, ClipboardList,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RouterCommandConsole } from "@/components/router-command-console";

// ─── Types ────────────────────────────────────────────────────────────────────
type RouterFormData = {
  name: string; routerType: string; ipAddress: string; port: string;
  username: string; password: string; description: string; location: string;
  apiSsl: boolean; sshPort: string; netconfPort: string; enabled: boolean;
  radiusSecret: string; radiusPort: string;
};

type EquipmentFormData = {
  name: string; type: string; model: string; brand: string; ipAddress: string;
  macAddress: string; location: string; status: string; notes: string;
};

type IpPoolFormData = {
  name: string; network: string; gateway: string; subnetMask: string;
  dns1: string; dns2: string; description: string;
};

const ROUTER_DEFAULTS: RouterFormData = {
  name: "", routerType: "routeros", ipAddress: "", port: "",
  username: "admin", password: "", description: "", location: "",
  apiSsl: false, sshPort: "", netconfPort: "", enabled: true,
  radiusSecret: "", radiusPort: "",
};

const EQUIPMENT_DEFAULTS: EquipmentFormData = {
  name: "", type: "router", model: "", brand: "", ipAddress: "",
  macAddress: "", location: "", status: "online", notes: "",
};

const POOL_DEFAULTS: IpPoolFormData = {
  name: "", network: "", gateway: "", subnetMask: "255.255.255.0",
  dns1: "8.8.8.8", dns2: "8.8.4.4", description: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function routerTypeLabel(t: string) {
  return { routeros: "RouterOS", juniper: "JunOS", edgerouter: "EdgeRouter" }[t] ?? t;
}

function routerTypeBadgeClass(t: string) {
  return {
    routeros: "bg-blue-50 text-blue-700 border-blue-200",
    juniper:  "bg-orange-50 text-orange-700 border-orange-200",
    edgerouter: "bg-purple-50 text-purple-700 border-purple-200",
  }[t] ?? "bg-gray-100 text-gray-600";
}

function statusDot(status: string) {
  if (status === "online")      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (status === "offline")     return <Circle className="w-4 h-4 text-red-400" />;
  if (status === "maintenance") return <WrenchIcon className="w-4 h-4 text-orange-400" />;
  return <AlertTriangle className="w-4 h-4 text-gray-400" />;
}

// ─── Router Provision Panel ───────────────────────────────────────────────────
type ProvisionInfo = {
  id: number;
  name: string;
  routerType: string;
  provisionToken: string | null;
  provisionStatus: string;
  macAddress: string | null;
  rosVersion: string | null;
  vpnConnected: boolean;
  sshHostKey: string | null;
  vpnIp: string | null;
  lastCallbackAt: string | null;
};

type VpnRepairResult = {
  success: boolean;
  state: "healthy" | "repaired" | "blocked" | "failed" | "unavailable";
  message: string;
  events: string[];
};

function normalizeVpnRepairResult(payload: unknown, responseOk: boolean): VpnRepairResult {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const allowedStates: VpnRepairResult["state"][] = ["healthy", "repaired", "blocked", "failed", "unavailable"];
  const state = allowedStates.includes(record.state as VpnRepairResult["state"])
    ? record.state as VpnRepairResult["state"]
    : "failed";
  const events = Array.isArray(record.events)
    ? record.events.filter((event): event is string => typeof event === "string")
    : [];

  return {
    success: responseOk && record.success === true,
    state,
    message: typeof record.message === "string"
      ? record.message
      : typeof record.error === "string"
        ? record.error
        : "The VPN repair service returned an unreadable response.",
    events,
  };
}

export function RouterProvisionPanel({ routerId, routerName }: { routerId: number; routerName: string }) {
  const { isAdmin, isOwner } = useCurrentUser();
  const canRepairVpnService = isAdmin || isOwner;
  const [info, setInfo] = useState<ProvisionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [reprovisioning, setReprovisioning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<VpnRepairResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/routers/${routerId}/provision-info`, { credentials: "include" });
      if (r.ok) setInfo(await r.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [routerId]);

  useEffect(() => {
    load();
    // Poll every 5 seconds while not yet connected
    const interval = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const reprovision = async () => {
    if (!confirm("Generate a new bootstrap token and VPN certificate for this router? The previous token will stop working.")) return;
    setReprovisioning(true);
    try {
      await fetch(`/api/routers/${routerId}/reprovision`, { method: "POST", credentials: "include" });
      await load();
    } finally {
      setReprovisioning(false);
    }
  };

  const repairVpnService = async () => {
    if (!confirm("Repair the central NetPulse VPN service? This may briefly reconnect VPN clients, but it will not change this router, Tabana-VPN, RADIUS, or customer traffic.")) return;
    setRepairing(true);
    setRepairResult(null);
    try {
      const response = await fetch("/api/infrastructure/vpn/repair-service", {
        method: "POST",
        credentials: "include",
      });
      const payload = await response.json().catch(() => null);
      setRepairResult(normalizeVpnRepairResult(payload, response.ok));
      if (response.ok) await load();
    } catch {
      setRepairResult({
        success: false,
        state: "failed",
        message: "Could not reach the VPN repair service.",
        events: [],
      });
    } finally {
      setRepairing(false);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const downloadBootstrap = () => {
    if (!info?.provisionToken) return;
    const a = document.createElement("a");
    a.href = `/api/provision/${info.provisionToken}/bootstrap.rsc`;
    a.download = `np-boot-${routerId}.rsc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const serverUrl = window.location.origin;
  const bootstrapCmd = info?.provisionToken
    ? `/tool fetch url="${serverUrl}/api/provision/${info.provisionToken}/bootstrap.rsc" dst-path="np-boot.rsc" mode=https; /import file-name=np-boot.rsc`
    : "";

  const status = info?.provisionStatus ?? "pending";
  const connected = info?.vpnConnected ?? false;

  const statusConfig = {
    pending:     { color: "text-amber-600",  bg: "bg-amber-50 border-amber-200",  dot: "bg-amber-400",  label: "Awaiting provisioning" },
    provisioned: { color: "text-blue-600",   bg: "bg-blue-50 border-blue-200",    dot: "bg-blue-400 animate-pulse", label: "Downloading config…" },
    connected:   { color: "text-green-600",  bg: "bg-green-50 border-green-200",  dot: "bg-green-500",  label: "VPN Tunnel Active" },
  }[status] ?? { color: "text-gray-600", bg: "bg-gray-50 border-gray-200", dot: "bg-gray-400", label: status };

  return (
    <div className="px-6 py-4 bg-emerald-50/40 border-t border-emerald-100 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-600" />
          <span className="text-sm font-semibold text-gray-800">Zero-Touch Provisioning</span>
          {!loading && (
            <div className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${statusConfig.bg} ${statusConfig.color}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${statusConfig.dot}`} />
              {statusConfig.label}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {connected && info?.vpnIp && (
            <Badge className="bg-green-100 text-green-700 border-green-200 text-xs font-mono border">
              VPN {info.vpnIp}
            </Badge>
          )}
          <Button size="sm" variant="outline"
            className="h-8 border-emerald-400 bg-white text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 gap-1"
            title="Generate a fresh provisioning command for this router"
            onClick={reprovision} disabled={reprovisioning}>
            {reprovisioning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            Reprovision
          </Button>
          {canRepairVpnService && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 gap-1"
              onClick={repairVpnService}
              disabled={repairing}
              title="Repair the central NetPulse OpenVPN service; this never changes the router itself"
            >
              {repairing ? <Loader2 className="w-3 h-3 animate-spin" /> : <WrenchIcon className="w-3 h-3" />}
              Repair VPN Service
            </Button>
          )}
          {!canRepairVpnService && (
            <span className="text-[11px] text-amber-700">
              Central VPN repair is available to administrators and the account owner only.
            </span>
          )}
        </div>
      </div>

      {repairResult && (
        <div className={`rounded-lg border px-4 py-3 text-xs ${repairResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          <p className="font-semibold">{repairResult.message}</p>
          {repairResult.events.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">Repair details</summary>
              <ul className="mt-1 list-disc space-y-1 pl-4 font-mono text-[11px]">
                {repairResult.events.map((event, index) => <li key={`${event}-${index}`}>{event}</li>)}
              </ul>
            </details>
          )}
          {!repairResult.success && (
            <div className="mt-2 rounded border border-amber-200 bg-white/70 px-2 py-1.5 text-[11px]">
              {repairResult.message.includes("Dedicated NetPulse VPN configuration")
                ? <>This server still uses the legacy generic VPN instance. After verifying that it is NetPulse—not Tabana-VPN—run <code className="font-mono">sudo bash /opt/netpulse/deploy/migrate-legacy-routeros-vpn.sh --confirm-legacy-netpulse-vpn</code> over SSH once.</>
                : repairResult.state === "unavailable"
                  ? <>VPN repair helper unavailable or not authorized. Run <code className="font-mono">sudo /usr/local/bin/netpulse-vpn-repair --json</code> over SSH, then check <code className="font-mono">journalctl -u openvpn-server@netpulse -n 50</code>.</>
                  : <>The VPN repair helper did not complete. Check <code className="font-mono">journalctl -u openvpn-server@netpulse -n 50</code> for the dedicated NetPulse service.</>}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <Skeleton className="h-20 w-full" />
      ) : !info?.provisionToken ? (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          No provision token yet. Click <strong>Reprovision</strong> to generate one.
        </div>
      ) : (
        <>
          {/* How it works */}
          {!connected && (
            <div className="text-xs text-gray-600 bg-white border border-emerald-100 rounded-lg px-4 py-3 space-y-1">
              <p className="font-semibold text-emerald-700 mb-1.5">How to provision this router in 1 step:</p>
              <p>1. Open a <strong>terminal</strong> on your MikroTik (via Winbox, SSH, or console)</p>
              <p>2. Paste the command below and press <strong>Enter</strong></p>
              <p>3. The router configures itself — VPN tunnel, RADIUS, and PPPoE ready automatically</p>
            </div>
          )}

          {/* The magic command */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">RouterOS Terminal Command</p>
            <div className="flex items-start gap-2 bg-gray-950 rounded-lg px-4 py-3">
              <code className="text-green-300 text-xs font-mono flex-1 break-all leading-relaxed">{bootstrapCmd}</code>
              <button
                onClick={() => copyText(bootstrapCmd, "cmd")}
                className="text-gray-400 hover:text-white transition-colors mt-0.5 flex-shrink-0 flex items-center gap-1 text-xs">
                {copied === "cmd" ? <><Check className="w-3.5 h-3.5 text-green-400" />Copied!</> : <><Copy className="w-3.5 h-3.5" />Copy</>}
              </button>
            </div>
          </div>

          {/* Download + info row */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-100"
              onClick={downloadBootstrap}>
              <Download className="w-3 h-3" /> Download .rsc
            </Button>

            {info.macAddress && (
              <span className="text-xs text-gray-500 font-mono">MAC: {info.macAddress}</span>
            )}
            {info.rosVersion && (
              <span className="text-xs text-gray-500">ROS: {info.rosVersion}</span>
            )}
            {info.lastCallbackAt && (
              <span className="text-xs text-gray-400">
                Last seen: {new Date(info.lastCallbackAt).toLocaleString()}
              </span>
            )}
          </div>

          {/* Connected state — unlocked management */}
          {connected && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-semibold text-green-800">Tunnel active — remote management unlocked</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" asChild>
                  <Link href={`/network/routers/${routerId}`}>
                    <LayoutDashboard className="w-3 h-3" /> RouterOS Dashboard
                  </Link>
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs border-green-300 text-green-700 hover:bg-green-100" asChild>
                  <Link href={`/network/routers/${routerId}/pppoe`}>
                    <Radio className="w-3 h-3" /> PPPoE Setup
                  </Link>
                </Button>
                <RouterCommandConsole routerId={routerId} routerName={routerName} vpnConnected={connected} sshHostKey={info?.sshHostKey} />
                <Button size="sm" variant="outline" className="gap-1.5 text-xs border-green-300 text-green-700 hover:bg-green-100" asChild>
                  <Link href={`/network/routers/${routerId}/hotspot`}>
                    <Wifi className="w-3 h-3" /> Hotspot Config
                  </Link>
                </Button>
              </div>
              {/* NETPULSE Bridge port manager */}
              <BridgePortsManager routerId={routerId} />
            </div>
          )}
          {!loading && !connected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-amber-900">Command console locked</p>
                <p className="text-xs text-amber-800">Connect this router’s private management VPN to enable SSH commands.</p>
              </div>
              <RouterCommandConsole routerId={routerId} routerName={routerName} vpnConnected={false} sshHostKey={info?.sshHostKey} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── NETPULSE Bridge Port Manager ────────────────────────────────────────────
function BridgePortsManager({ routerId }: { routerId: number }) {
  const [ports, setPorts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPort, setNewPort] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [lastCmd, setLastCmd] = useState<string | null>(null);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPorts = useCallback(async () => {
    try {
      const r = await fetch(`/api/routers/${routerId}/bridge-ports`, { credentials: "include" });
      if (r.ok) { const d = await r.json(); setPorts(d.ports ?? []); }
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [routerId]);

  useEffect(() => { loadPorts(); }, [loadPorts]);

  const addPort = async () => {
    const port = newPort.trim();
    if (!port) return;
    setAdding(true);
    setError(null);
    try {
      const r = await fetch(`/api/routers/${routerId}/bridge-ports`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? "Failed to add port"); return; }
      setPorts(d.ports);
      setLastCmd(d.command);
      setNewPort("");
    } finally { setAdding(false); }
  };

  const removePort = async (portName: string) => {
    setRemoving(portName);
    setError(null);
    try {
      const r = await fetch(`/api/routers/${routerId}/bridge-ports/${portName}`, {
        method: "DELETE",
        credentials: "include",
      });
      const d = await r.json();
      if (r.ok) { setPorts(d.ports); setLastCmd(d.command); }
    } finally { setRemoving(null); }
  };

  const copyCmd = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCmdCopied(true);
    setTimeout(() => setCmdCopied(false), 2000);
  };

  return (
    <div className="mt-3 border border-emerald-200 rounded-lg bg-white overflow-hidden">
      <div className="px-3 py-2 bg-emerald-50/80 border-b border-emerald-200 flex items-center gap-2">
        <Route className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-xs font-semibold text-emerald-800">NETPULSE Bridge Ports</span>
        <span className="ml-auto text-[10px] text-emerald-500 font-mono bg-emerald-100 px-1.5 py-0.5 rounded">
          PPPoE + Hotspot on bridge
        </span>
      </div>

      {loading ? (
        <div className="px-3 py-2"><Skeleton className="h-5 w-40" /></div>
      ) : (
        <div className="px-3 py-2 space-y-1.5">
          {ports.length === 0 && (
            <p className="text-[11px] text-gray-400 italic">No ports in bridge yet.</p>
          )}
          {ports.map(port => (
            <div key={port} className="flex items-center gap-2 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <code className="font-mono text-gray-700 flex-1">{port}</code>
              {port === "ether2"
                ? <span className="text-[10px] text-gray-400 italic">default</span>
                : (
                  <button
                    onClick={() => removePort(port)}
                    disabled={removing === port}
                    title="Remove from bridge"
                    className="text-gray-300 hover:text-red-500 transition-colors">
                    {removing === port
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <XIcon className="w-3.5 h-3.5" />}
                  </button>
                )
              }
            </div>
          ))}

          {/* Add port row */}
          <div className="flex items-center gap-1.5 pt-1">
            <Input
              value={newPort}
              onChange={e => setNewPort(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !adding && addPort()}
              placeholder="ether3, ether4, wlan1…"
              className="h-6 text-xs font-mono border-emerald-200 focus-visible:ring-emerald-400"
            />
            <Button
              size="sm"
              onClick={addPort}
              disabled={adding || !newPort.trim()}
              className="h-6 text-xs px-2 bg-emerald-600 hover:bg-emerald-700 text-white gap-1 flex-shrink-0">
              {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Add
            </Button>
          </div>

          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
      )}

      {/* Command to apply — copy and run on the router */}
      {lastCmd && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gray-950 border-t border-gray-800">
          <code className="text-green-300 text-[10px] font-mono flex-1 break-all leading-relaxed">{lastCmd}</code>
          <button
            onClick={() => copyCmd(lastCmd)}
            title="Copy command"
            className="text-gray-400 hover:text-white transition-colors flex-shrink-0">
            {cmdCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}
      {lastCmd && (
        <p className="px-3 pb-2 text-[10px] text-gray-400 bg-gray-950">
          ↑ Copy and run in RouterOS terminal to apply this change on the router
        </p>
      )}
    </div>
  );
}

// ─── Router VPN Panel ─────────────────────────────────────────────────────────
type RouterVpnEntry = {
  id: number;
  routerId: number | null;
  commonName: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
  connected: boolean;
  remoteIp: string | null;
  vpnAvailable: boolean;
  ovpnConfig?: string;
};

function RouterVpnPanel({ routerId }: { routerId: number }) {
  const [loading, setLoading] = useState(true);
  const [vpnAvailable, setVpnAvailable] = useState(false);
  const [configs, setConfigs] = useState<RouterVpnEntry[]>([]);
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/routers/${routerId}/vpn`, { credentials: "include" });
      const data = await r.json();
      setVpnAvailable(data.vpnAvailable);
      setConfigs(data.configs ?? []);
    } catch {
      setError("Failed to load VPN configs");
    } finally {
      setLoading(false);
    }
  }, [routerId]);

  useEffect(() => { load(); }, [load]);

  const handleIssue = async () => {
    setIssuing(true);
    setError(null);
    try {
      const r = await fetch(`/api/routers/${routerId}/vpn`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const e = await r.json();
        setError(e.error ?? "Issue failed");
        return;
      }
      const entry: RouterVpnEntry = await r.json();
      if (entry.ovpnConfig) {
        const blob = new Blob([entry.ovpnConfig], { type: "application/x-openvpn-profile" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${entry.commonName}.ovpn`;
        a.click();
        URL.revokeObjectURL(url);
      }
      await load();
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async (configId: number) => {
    if (!confirm("Revoke this VPN certificate? The router will lose VPN access.")) return;
    setRevoking(configId);
    try {
      await fetch(`/api/routers/${routerId}/vpn/${configId}`, {
        method: "DELETE",
        credentials: "include",
      });
      await load();
    } finally {
      setRevoking(null);
    }
  };

  const handleDownload = (configId: number, cn: string) => {
    const a = document.createElement("a");
    a.href = `/api/routers/${routerId}/vpn/${configId}/download`;
    a.download = `${cn}.ovpn`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const activeConfigs = configs.filter(c => !c.revokedAt);
  const revokedConfigs = configs.filter(c => c.revokedAt);

  return (
    <div className="px-6 py-4 bg-indigo-50/40 border-t border-indigo-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-medium text-gray-800">VPN Certificates</span>
          {!vpnAvailable && (
            <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">
              VPN server not configured
            </Badge>
          )}
        </div>
        {vpnAvailable && (
          <Button size="sm" variant="outline"
            className="h-7 text-xs border-indigo-300 text-indigo-700 hover:bg-indigo-100"
            onClick={handleIssue} disabled={issuing}>
            {issuing ? "Issuing…" : <><Plus className="w-3 h-3 mr-1" />Issue Cert</>}
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {loading ? (
        <Skeleton className="h-8 w-full" />
      ) : activeConfigs.length === 0 && revokedConfigs.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No VPN certificates issued for this router yet.</p>
      ) : (
        <div className="space-y-1.5">
          {activeConfigs.map(c => (
            <div key={c.id}
              className="flex items-center gap-2 bg-white rounded border border-indigo-100 px-3 py-1.5 text-xs">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${c.connected ? "bg-green-500" : "bg-gray-300"}`} />
              <code className="text-gray-700 flex-1 truncate">{c.commonName}</code>
              {c.connected && (
                <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px] px-1.5 border">
                  {c.remoteIp ?? "connected"}
                </Badge>
              )}
              <span className="text-gray-400 flex-shrink-0">
                {new Date(c.issuedAt).toLocaleDateString()}
              </span>
              <Button size="icon" variant="ghost" className="h-5 w-5 text-gray-400 hover:text-indigo-600"
                title="Download .ovpn" onClick={() => handleDownload(c.id, c.commonName)}>
                <Download className="w-3 h-3" />
              </Button>
              <Button size="icon" variant="ghost" className="h-5 w-5 text-gray-400 hover:text-red-600"
                title="Revoke certificate" onClick={() => handleRevoke(c.id)}
                disabled={revoking === c.id}>
                <XIcon className="w-3 h-3" />
              </Button>
            </div>
          ))}
          {revokedConfigs.length > 0 && (
            <details className="text-xs text-gray-400 mt-1">
              <summary className="cursor-pointer hover:text-gray-600 select-none">
                {revokedConfigs.length} revoked cert{revokedConfigs.length > 1 ? "s" : ""}
              </summary>
              <div className="mt-1 space-y-1">
                {revokedConfigs.map(c => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-1 opacity-50">
                    <code className="flex-1 truncate line-through">{c.commonName}</code>
                    {c.revokedBy && <span className="flex-shrink-0">by {c.revokedBy}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Router Dialog ────────────────────────────────────────────────────────────
function RouterDialog({
  open, onClose, initial, routerId,
}: {
  open: boolean;
  onClose: () => void;
  initial?: RouterFormData;
  routerId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateRouter();
  const updateMutation = useUpdateRouter();
  const [form, setForm] = useState<RouterFormData>(initial ?? ROUTER_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (k: keyof RouterFormData, v: string | boolean) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const basePayload = {
        name: form.name,
        ipAddress: form.routerType === "routeros" ? "" : form.ipAddress,
        port: form.port ? parseInt(form.port) : undefined,
        username: form.username,
        password: form.password,
        description: form.description || undefined,
        location: form.location || undefined,
        apiSsl: form.apiSsl,
        sshPort: form.sshPort ? parseInt(form.sshPort) : undefined,
        netconfPort: form.netconfPort ? parseInt(form.netconfPort) : undefined,
        enabled: form.enabled,
        radiusSecret: form.radiusSecret || undefined,
        radiusPort: form.radiusPort ? parseInt(form.radiusPort) : undefined,
      };
      if (routerId) {
        await updateMutation.mutateAsync({
          id: routerId,
          data: { ...basePayload, routerType: form.routerType as RouterDeviceUpdateRouterType },
        });
      } else {
        await createMutation.mutateAsync({
          data: { ...basePayload, routerType: form.routerType as RouterDeviceInputRouterType },
        });
      }
      await qc.invalidateQueries({ queryKey: ["/api/routers"] });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{routerId ? "Edit Router" : "Add Router"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name / Location *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Core-Router-01" />
            </div>
            <div className="space-y-1">
              <Label>Router Type *</Label>
              <Select value={form.routerType} onValueChange={(v) => set("routerType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="routeros">MikroTik RouterOS</SelectItem>
                  <SelectItem value="juniper">Juniper JunOS</SelectItem>
                  <SelectItem value="edgerouter">Ubiquiti EdgeRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              {form.routerType === "routeros" ? (
                <>
                  <Label>Private VPN IP</Label>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Assigned automatically after zero-touch provisioning
                  </div>
                </>
              ) : (
                <>
                  <Label>IP Address *</Label>
                  <Input value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)} placeholder="192.168.1.1" />
                </>
              )}
            </div>
            <div className="space-y-1">
              <Label>
                {form.routerType === "routeros" ? "API Port" : "SSH Port"}
              </Label>
              <Input
                type="number"
                value={form.routerType === "routeros" ? form.port : form.sshPort}
                onChange={(e) =>
                  form.routerType === "routeros"
                    ? set("port", e.target.value)
                    : set("sshPort", e.target.value)
                }
                placeholder={form.routerType === "routeros" ? "8728" : "22"}
              />
            </div>
          </div>

          {form.routerType === "juniper" && (
            <div className="space-y-1">
              <Label>NETCONF Port</Label>
              <Input type="number" value={form.netconfPort} onChange={(e) => set("netconfPort", e.target.value)} placeholder="830" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Username *</Label>
              <Input value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="admin" />
            </div>
            <div className="space-y-1">
              <Label>Password *</Label>
              <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••" />
            </div>
          </div>

          {form.routerType === "routeros" && (
            <div className="flex items-center gap-3">
              <Switch checked={form.apiSsl} onCheckedChange={(v) => set("apiSsl", v)} id="apiSsl" />
              <Label htmlFor="apiSsl" className="text-sm cursor-pointer">Use SSL/TLS for API connection (port 8729)</Label>
            </div>
          )}

          <div className="space-y-1">
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Data Centre, Rack 3" />
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className="resize-none" placeholder="Core BGP router serving Zone A" />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} id="enabled" />
            <Label htmlFor="enabled" className="text-sm cursor-pointer">Enabled (monitored by system)</Label>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">RADIUS (optional)</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>RADIUS Shared Secret</Label>
                <Input
                  type="password"
                  value={form.radiusSecret}
                  onChange={(e) => set("radiusSecret", e.target.value)}
                  placeholder="e.g. testing123"
                />
              </div>
              <div className="space-y-1">
                <Label>RADIUS Auth Port</Label>
                <Input
                  type="number"
                  value={form.radiusPort}
                  onChange={(e) => set("radiusPort", e.target.value)}
                  placeholder="1812"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              Set a shared secret to register this router as a NAS device in FreeRADIUS.
            </p>
          </div>
        </div>
        {saveError && <p className="text-sm text-red-600 text-center px-1">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.username || (form.routerType !== "routeros" && !form.ipAddress)}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : routerId ? "Update" : "Add Router"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Equipment Dialog ────────────────────────────────────────────────────────
function EquipmentDialog({
  open, onClose, initial, equipmentId,
}: {
  open: boolean; onClose: () => void; initial?: EquipmentFormData; equipmentId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateEquipment();
  const updateMutation = useUpdateEquipment();
  const [form, setForm] = useState<EquipmentFormData>(initial ?? EQUIPMENT_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [brandAutoFilled, setBrandAutoFilled] = useState(false);

  const set = (k: keyof EquipmentFormData, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const { vendor: detectedVendor, loading: vendorLoading } = useMacVendor(form.macAddress);

  useEffect(() => {
    if (detectedVendor && !form.brand) {
      set("brand", detectedVendor);
      setBrandAutoFilled(true);
    }
  }, [detectedVendor]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (equipmentId) {
        await updateMutation.mutateAsync({
          id: equipmentId,
          data: {
            name: form.name, model: form.model, ipAddress: form.ipAddress,
            brand: form.brand || null, macAddress: form.macAddress || null,
            location: form.location || null, notes: form.notes || null,
          } as EquipmentUpdate,
        });
      } else {
        await createMutation.mutateAsync({
          data: {
            name: form.name, type: form.type, model: form.model, ipAddress: form.ipAddress,
            brand: form.brand || undefined, macAddress: form.macAddress || undefined,
            location: form.location || undefined, status: form.status || undefined,
            notes: form.notes || undefined,
          } as EquipmentInput,
        });
      }
      await qc.invalidateQueries({ queryKey: ["/api/equipment"] });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{equipmentId ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Core Switch 01" />
            </div>
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["router","switch","olt","onu","access_point","server","other"].map((t) => (
                    <SelectItem key={t} value={t}>{t.replace("_"," ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5">
                Brand
                {vendorLoading && (
                  <span className="text-[10px] text-blue-500 animate-pulse">looking up…</span>
                )}
                {brandAutoFilled && !vendorLoading && (
                  <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded px-1">auto-detected</span>
                )}
              </Label>
              <Input
                value={form.brand}
                onChange={(e) => { set("brand", e.target.value); setBrandAutoFilled(false); }}
                placeholder={vendorLoading ? "Detecting…" : "Cisco"}
              />
            </div>
            <div className="space-y-1">
              <Label>Model *</Label>
              <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="Catalyst 2960" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>IP Address *</Label>
              <Input value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)} placeholder="10.0.0.1" />
            </div>
            <div className="space-y-1">
              <Label>MAC Address</Label>
              <Input
                value={form.macAddress}
                onChange={(e) => { set("macAddress", e.target.value); setBrandAutoFilled(false); }}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
              {detectedVendor && (
                <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                  {detectedVendor}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Rack 2, DC Floor 1" />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} className="resize-none" />
          </div>
        </div>
        {saveError && <p className="text-sm text-red-600 text-center px-1">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.ipAddress || !form.model}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : equipmentId ? "Update" : "Add Equipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── IP Pool Dialog ───────────────────────────────────────────────────────────
function IpPoolDialog({
  open, onClose, initial, poolId,
}: {
  open: boolean; onClose: () => void; initial?: IpPoolFormData; poolId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateIpPool();
  const updateMutation = useUpdateIpPool();
  const [form, setForm] = useState<IpPoolFormData>(initial ?? POOL_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (k: keyof IpPoolFormData, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: form.name, network: form.network, gateway: form.gateway,
        subnetMask: form.subnetMask, dns1: form.dns1 || undefined,
        dns2: form.dns2 || undefined, description: form.description || undefined,
      };
      if (poolId) {
        await updateMutation.mutateAsync({ id: poolId, data: payload });
      } else {
        await createMutation.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: ["/api/ip-pools"] });
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{poolId ? "Edit IP Pool" : "Add IP Pool"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Pool Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Customer Pool A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Network (CIDR) *</Label>
              <Input value={form.network} onChange={(e) => set("network", e.target.value)} placeholder="192.168.1.0/24" />
            </div>
            <div className="space-y-1">
              <Label>Gateway *</Label>
              <Input value={form.gateway} onChange={(e) => set("gateway", e.target.value)} placeholder="192.168.1.1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Subnet Mask *</Label>
              <Input value={form.subnetMask} onChange={(e) => set("subnetMask", e.target.value)} placeholder="255.255.255.0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Primary DNS</Label>
              <Input value={form.dns1} onChange={(e) => set("dns1", e.target.value)} placeholder="8.8.8.8" />
            </div>
            <div className="space-y-1">
              <Label>Secondary DNS</Label>
              <Input value={form.dns2} onChange={(e) => set("dns2", e.target.value)} placeholder="8.8.4.4" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className="resize-none" />
          </div>
        </div>
        {saveError && <p className="text-sm text-red-600 text-center px-1">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.network || !form.gateway}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : poolId ? "Update" : "Add Pool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Network() {
  const { data: equipmentData, isLoading: loadingEquipment } = useListEquipment();
  const { data: ipPoolsData, isLoading: loadingIpPools } = useListIpPools();
  const { data: routersData, isLoading: loadingRouters, isError: isRoutersError, error: routersError, refetch: refetchRouters } = useListRouters();

  const deleteEquipment = useDeleteEquipment();
  const deletePool = useDeleteIpPool();
  const deleteRouter = useDeleteRouter();
  const qc = useQueryClient();
  const { canManageNetwork, canDeleteNetworkRecords } = useCurrentUser();

  // Panel expand state
  const [expandedVpn, setExpandedVpn] = useState<number | null>(null);
  const [expandedRadius, setExpandedRadius] = useState<number | null>(null);
  const [expandedProvision, setExpandedProvision] = useState<number | null>(null);
  const [radiusCopied, setRadiusCopied] = useState<string | null>(null);
  const copyRadius = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setRadiusCopied(key);
    setTimeout(() => setRadiusCopied(null), 2000);
  };
  const [adminLoginRunning, setAdminLoginRunning] = useState<number | null>(null);
  const [adminLoginResult, setAdminLoginResult] = useState<{ routerId: number; success: boolean; steps: string[]; errors: string[] } | null>(null);
  const handleEnableAdminLogin = async (routerId: number) => {
    setAdminLoginRunning(routerId);
    setAdminLoginResult(null);
    try {
      const r = await fetch(`/api/routers/${routerId}/ros/radius/admin-login`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) {
        setAdminLoginResult({ routerId, success: false, steps: [], errors: [data.error ?? "Failed to enable RADIUS admin login"] });
        return;
      }
      setAdminLoginResult({ routerId, success: data.success, steps: data.steps ?? [], errors: data.errors ?? [] });
    } catch {
      setAdminLoginResult({ routerId, success: false, steps: [], errors: ["Network error contacting router"] });
    } finally {
      setAdminLoginRunning(null);
    }
  };

  // Router dialog
  const [routerDialog, setRouterDialog] = useState<{ open: boolean; id?: number; initial?: RouterFormData }>({ open: false });
  const [reprovisioningRouterId, setReprovisioningRouterId] = useState<number | null>(null);
  const [reprovisionError, setReprovisionError] = useState<{ routerId: number; message: string } | null>(null);
  // Equipment dialog
  const [equipDialog, setEquipDialog] = useState<{ open: boolean; id?: number; initial?: EquipmentFormData }>({ open: false });
  // IP Pool dialog
  const [poolDialog, setPoolDialog] = useState<{ open: boolean; id?: number; initial?: IpPoolFormData }>({ open: false });

  // ── Traffic Analysis state ─────────────────────────────────────────────────
  type TopDomain  = { domain: string; category: string; totalHits: number; lastSeen: string };
  type CatTotal   = { category: string; totalHits: number; uniqueDomains: number };
  type DailyPoint = { date: string; totalHits: number; uniqueDomains: number };
  type TrafficData = { topDomains: TopDomain[]; categoryTotals: CatTotal[]; dailyTrend: DailyPoint[] };

  const TRAFFIC_RANGES = [
    { label: "Today", days: 0 },
    { label: "7D",    days: 7 },
    { label: "30D",   days: 30 },
    { label: "3M",    days: 90 },
  ] as const;
  type TrafRangeLabel = typeof TRAFFIC_RANGES[number]["label"];

  const CAT_COLORS: Record<string, string> = {
    streaming:    "#ef4444",
    social:       "#3b82f6",
    search:       "#10b981",
    conferencing: "#8b5cf6",
    vpn:          "#f59e0b",
    cloud:        "#06b6d4",
    software:     "#6366f1",
    finance:      "#84cc16",
    gaming:       "#ec4899",
    education:    "#14b8a6",
    development:  "#f97316",
    news:         "#a78bfa",
    other:        "#9ca3af",
  };

  const [trafRange,     setTrafRange]     = useState<TrafRangeLabel>("7D");
  const [trafRouter,    setTrafRouter]    = useState<string>("all");
  const [trafData,      setTrafData]      = useState<TrafficData | null>(null);
  const [loadingTraf,   setLoadingTraf]   = useState(false);
  const trafAbort = useRef<AbortController | null>(null);

  const fetchTraffic = useCallback(async (range: TrafRangeLabel, routerId: string) => {
    trafAbort.current?.abort();
    const ctrl = new AbortController();
    trafAbort.current = ctrl;
    setLoadingTraf(true);
    try {
      const days = TRAFFIC_RANGES.find(r => r.label === range)?.days ?? 7;
      const now  = new Date();
      const to   = now.toISOString().slice(0, 10);
      const from = days === 0
        ? to
        : (() => { const d = new Date(now); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); })();
      const params = new URLSearchParams({ from, to });
      if (routerId !== "all") params.set("routerId", routerId);
      const r = await fetch(`/api/network/traffic?${params}`, { signal: ctrl.signal });
      if (r.ok) setTrafData(await r.json());
    } catch { /* aborted */ } finally {
      setLoadingTraf(false);
    }
  }, []);

  useEffect(() => { fetchTraffic(trafRange, trafRouter); }, [trafRange, trafRouter, fetchTraffic]);

  const handleDeleteRouter = async (id: number) => {
    if (!confirm("Delete this router?")) return;
    await deleteRouter.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/routers"] });
  };

  const handleReprovisionRouter = async (routerId: number, routerName: string) => {
    if (!confirm(`Reprovision ${routerName}? This creates a new setup token and VPN certificate. The previous setup file will stop working.`)) {
      return;
    }

    setReprovisioningRouterId(routerId);
    setReprovisionError(null);
    try {
      const response = await fetch(`/api/routers/${routerId}/reprovision`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not reprovision this router.");
      }
      await qc.invalidateQueries({ queryKey: ["/api/routers"] });
      setExpandedProvision(routerId);
    } catch (error) {
      setReprovisionError({
        routerId,
        message: error instanceof Error ? error.message : "Could not reprovision this router.",
      });
    } finally {
      setReprovisioningRouterId(null);
    }
  };

  const handleDeleteEquipment = async (id: number) => {
    if (!confirm("Delete this equipment?")) return;
    await deleteEquipment.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/equipment"] });
  };

  const handleDeletePool = async (id: number) => {
    if (!confirm("Delete this IP pool?")) return;
    await deletePool.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/ip-pools"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Network Infrastructure</h1>
        <p className="text-gray-500 text-sm">Manage routers, equipment, and IP resources.</p>
      </div>

      <Tabs defaultValue="routers" className="w-full">
        <TabsList className="bg-gray-100 flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="routers" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Wifi className="w-4 h-4" /> Routers
            {routersData && (
              <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-xs px-1.5">{routersData.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="equipment" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Server className="w-4 h-4" /> Equipment
            {equipmentData && (
              <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-xs px-1.5">{equipmentData.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ippools" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Route className="w-4 h-4" /> IP Pools
            {ipPoolsData && (
              <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-xs px-1.5">{ipPoolsData.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="hotspot" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Wifi className="w-4 h-4" /> Hotspot
          </TabsTrigger>
          <TabsTrigger value="traffic" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <BarChart2 className="w-4 h-4" /> Traffic Analysis
          </TabsTrigger>
          <TabsTrigger value="fiber" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Radio className="w-4 h-4" /> Fiber Access
          </TabsTrigger>
        </TabsList>

        {/* ── ROUTERS ───────────────────────────────────────────────────── */}
        <TabsContent value="routers" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {canManageNetwork && (
              <div className="p-4 border-b border-gray-200 flex justify-end">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm"
                  onClick={() => setRouterDialog({ open: true })}>
                  <Plus className="w-4 h-4 mr-2" /> Add Router
                </Button>
              </div>
            )}
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Management IP</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isRoutersError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-red-500">
                      <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-60" />
                      <p className="text-sm font-medium">Couldn't load routers</p>
                      <p className="text-xs text-gray-500 mt-0.5">{(routersError as any)?.message ?? "Request failed. Your data is safe — this is a connection issue, not data loss."}</p>
                      <Button variant="link" size="sm" className="mt-1 text-blue-600" onClick={() => refetchRouters()}>
                        Retry
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : loadingRouters ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : routersData && routersData.length > 0 ? (
                  routersData.map((r) => (
                    <Fragment key={r.id}>
                    <TableRow className="hover:bg-gray-50/50">
                      <TableCell>
                        <div className={`w-2 h-2 rounded-full mx-auto ${r.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${routerTypeBadgeClass(r.routerType)}`}>
                          {routerTypeLabel(r.routerType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-600">
                        {r.routerType === "routeros"
                          ? ((r as any).vpnIp ?? "VPN IP assigned after provisioning")
                          : `${r.ipAddress}${r.port ? `:${r.port}` : ""}`}
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm">{r.location || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={r.enabled ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500"}>
                            {r.enabled ? "Active" : "Disabled"}
                          </Badge>
                          {r.routerType === "routeros" && (r as any).vpnConnected && (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              VPN
                            </Badge>
                          )}
                          {r.routerType === "routeros" && !(r as any).vpnConnected && (r as any).provisionToken && (
                            <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[10px]">
                              {(r as any).provisionStatus === "provisioned" ? "Provisioning…" : "Unprovisioned"}
                            </Badge>
                          )}
                          {r.routerType === "routeros" && canManageNetwork && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 border-emerald-300 px-2 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                              title={`Create a fresh setup file for ${r.name}`}
                              onClick={() => { void handleReprovisionRouter(r.id, r.name); }}
                              disabled={reprovisioningRouterId === r.id}
                            >
                              {reprovisioningRouterId === r.id
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <RotateCcw className="mr-1 h-3 w-3" />}
                              Reprovision
                            </Button>
                          )}
                        </div>
                        {reprovisionError?.routerId === r.id && (
                          <p className="mt-1 text-xs text-red-600">{reprovisionError.message}</p>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-indigo-600"
                              title="Live RouterOS Dashboard"
                              asChild>
                              <Link href={`/network/routers/${r.id}`}>
                                <LayoutDashboard className="w-3.5 h-3.5" />
                              </Link>
                            </Button>
                          )}
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-green-600"
                              title="Download VPN .rsc script"
                              onClick={() => {
                                const a = document.createElement("a");
                                a.href = `/api/routers/${r.id}/ros-script`;
                                a.download = `netpulse-vpn-router-${r.id}.rsc`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                              }}>
                              <FileCode2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon"
                              className={`h-7 w-7 ${expandedVpn === r.id ? "text-indigo-600 bg-indigo-50" : "text-gray-500 hover:text-indigo-600"}`}
                              title="Manage VPN certificates"
                              onClick={() => setExpandedVpn(expandedVpn === r.id ? null : r.id)}>
                              <KeyRound className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon"
                              className={`h-7 w-7 ${expandedRadius === r.id ? "text-blue-600 bg-blue-50" : "text-gray-500 hover:text-blue-600"}`}
                              title="RADIUS configuration for this router"
                              onClick={() => setExpandedRadius(expandedRadius === r.id ? null : r.id)}>
                              <Shield className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon"
                              className={`h-7 w-7 ${expandedProvision === r.id ? "text-emerald-600 bg-emerald-50" : "text-gray-500 hover:text-emerald-600"} ${(r as any).vpnConnected ? "ring-1 ring-emerald-400/60 rounded" : ""}`}
                              title="Zero-touch provisioning"
                              onClick={() => setExpandedProvision(expandedProvision === r.id ? null : r.id)}>
                              <Zap className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canManageNetwork && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                              onClick={() => setRouterDialog({
                                open: true, id: r.id,
                                initial: {
                                  name: r.name, routerType: r.routerType, ipAddress: r.ipAddress,
                                  port: r.port?.toString() ?? "", username: r.username, password: r.password ?? "",
                                  description: r.description ?? "", location: r.location ?? "",
                                  apiSsl: r.apiSsl ?? false,
                                  sshPort: r.sshPort?.toString() ?? "", netconfPort: r.netconfPort?.toString() ?? "",
                                  enabled: r.enabled,
                                  radiusSecret: (r as any).radiusSecret ?? "",
                                  radiusPort: (r as any).radiusPort?.toString() ?? "",
                                },
                              })}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canDeleteNetworkRecords && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                              onClick={() => handleDeleteRouter(r.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedVpn === r.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0 border-b border-indigo-100">
                          <RouterVpnPanel routerId={r.id} />
                        </TableCell>
                      </TableRow>
                    )}
                    {expandedProvision === r.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0 border-b border-emerald-100">
                          <RouterProvisionPanel routerId={r.id} routerName={r.name} />
                        </TableCell>
                      </TableRow>
                    )}
                    {expandedRadius === r.id && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0 border-b border-blue-100">
                          <div className="bg-blue-50/60 px-6 py-4 space-y-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Shield className="w-4 h-4 text-blue-600" />
                              <span className="font-semibold text-blue-900 text-sm">RADIUS / NAS Configuration</span>
                              <span className="text-xs text-blue-500 ml-auto">RouterOS commands for <span className="font-mono">{r.name}</span></span>
                            </div>

                            {!(r as any).radiusSecret ? (
                              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                                No RADIUS secret set for this router. Edit the router and add a Shared Secret under the RADIUS section.
                              </div>
                            ) : (
                              <>
                                <p className="text-xs text-blue-700">
                                  Run these commands on <span className="font-mono font-semibold">{r.ipAddress}</span> via RouterOS terminal or Winbox. Replace <span className="font-mono bg-blue-100 px-1 rounded">&lt;SERVER_IP&gt;</span> with your NetPulse server IP (set in Settings → RADIUS Server).
                                </p>
                                {[
                                  {
                                    label: "Add RADIUS server",
                                    key: "add",
                                    cmd: `/radius add address=<SERVER_IP> secret=${(r as any).radiusSecret} service=ppp authentication-port=1812 accounting-port=${(r as any).radiusPort ?? 1813}`,
                                  },
                                  {
                                    label: "Enable RADIUS for PPPoE",
                                    key: "aaa",
                                    cmd: `/ip ppp aaa set use-radius=yes accounting=yes`,
                                  },
                                  {
                                    label: "Reload RADIUS config",
                                    key: "reload",
                                    cmd: `/radius print`,
                                  },
                                ].map(({ label, key, cmd }) => (
                                  <div key={key} className="space-y-1">
                                    <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide">{label}</p>
                                    <div className="flex items-start gap-2 bg-gray-900 rounded-md px-3 py-2">
                                      <code className="text-green-300 text-xs font-mono flex-1 break-all">{cmd}</code>
                                      <button
                                        onClick={() => copyRadius(cmd, key)}
                                        className="text-gray-400 hover:text-white transition-colors mt-0.5 flex-shrink-0">
                                        {radiusCopied === key
                                          ? <Check className="w-3.5 h-3.5 text-green-400" />
                                          : <Copy className="w-3.5 h-3.5" />}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                                <div className="text-xs text-blue-600 bg-blue-100 rounded px-3 py-2 mt-1">
                                  <strong>NAS registered:</strong> this router's IP (<span className="font-mono">{r.ipAddress}</span>) and secret are stored in FreeRADIUS's <span className="font-mono">radnas</span> table automatically when the router is saved.
                                </div>

                                <div className="border-t border-blue-200 pt-3 mt-3">
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <div>
                                      <p className="text-xs font-semibold text-blue-900">Admin login via RADIUS</p>
                                      <p className="text-[11px] text-blue-600">
                                        Lets staff log into this router (Winbox/SSH/web/API) with RADIUS credentials instead of local router accounts.
                                      </p>
                                    </div>
                                    {canManageNetwork && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100"
                                        disabled={adminLoginRunning === r.id}
                                        onClick={() => handleEnableAdminLogin(r.id)}>
                                        {adminLoginRunning === r.id ? "Configuring…" : "Enable admin login via RADIUS"}
                                      </Button>
                                    )}
                                  </div>
                                  {adminLoginResult && adminLoginResult.routerId === r.id && (
                                    <div className={`text-xs rounded-md px-3 py-2 mt-2 space-y-0.5 ${adminLoginResult.success ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
                                      {adminLoginResult.steps.map((s, i) => <div key={`s-${i}`}>{s}</div>)}
                                      {adminLoginResult.errors.map((e, i) => <div key={`e-${i}`}>{e}</div>)}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-gray-400">
                      <Wifi className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No routers added yet.</p>
                      <Button variant="link" size="sm" className="mt-1 text-blue-600"
                        onClick={() => setRouterDialog({ open: true })}>
                        Add your first router →
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── EQUIPMENT ─────────────────────────────────────────────────── */}
        <TabsContent value="equipment" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {canManageNetwork && (
              <div className="p-4 border-b border-gray-200 flex justify-end">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm"
                  onClick={() => setEquipDialog({ open: true })}>
                  <Plus className="w-4 h-4 mr-2" /> Add Equipment
                </Button>
              </div>
            )}
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead className="w-10">Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Brand / Model</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEquipment ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : equipmentData && equipmentData.length > 0 ? (
                  equipmentData.map((item) => (
                    <TableRow key={item.id} className="hover:bg-gray-50/50">
                      <TableCell>
                        <div className="flex items-center justify-center">
                          {statusDot(item.status)}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize bg-gray-100 text-gray-700 border-0 text-xs">
                          {item.type.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {item.brand && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 w-fit">
                              {item.brand}
                            </span>
                          )}
                          <span className="text-sm text-gray-600">{item.model}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-600">{item.ipAddress}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{item.location || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-gray-400 hover:text-blue-600"
                            asChild
                            title="View audit log"
                          >
                            <Link href={`/audit-logs?entityType=equipment&entityId=${item.id}`}>
                              <ClipboardList className="w-3.5 h-3.5" />
                            </Link>
                          </Button>
                          {canManageNetwork && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                              onClick={() => setEquipDialog({
                                open: true, id: item.id,
                                initial: {
                                  name: item.name, type: item.type, model: item.model,
                                  brand: item.brand ?? "", ipAddress: item.ipAddress,
                                  macAddress: item.macAddress ?? "", location: item.location ?? "",
                                  status: item.status, notes: item.notes ?? "",
                                },
                              })}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {canDeleteNetworkRecords && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                              onClick={() => handleDeleteEquipment(item.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-gray-400">
                      <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No equipment found.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="fiber" className="mt-6">
          <FiberAccessWorkspace
            canManageNetwork={canManageNetwork}
            canDeleteNetworkRecords={canDeleteNetworkRecords}
          />
        </TabsContent>

        {/* ── IP POOLS ──────────────────────────────────────────────────── */}
        <TabsContent value="ippools" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            {canManageNetwork && (
              <div className="p-4 border-b border-gray-200 flex justify-end">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm"
                  onClick={() => setPoolDialog({ open: true })}>
                  <Plus className="w-4 h-4 mr-2" /> Add IP Pool
                </Button>
              </div>
            )}
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Pool Name / CIDR</TableHead>
                  <TableHead className="w-1/4">Usage</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>DNS Servers</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingIpPools ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : ipPoolsData && ipPoolsData.length > 0 ? (
                  ipPoolsData.map((pool) => {
                    const usagePct = Math.round((pool.usedIps / Math.max(pool.totalIps, 1)) * 100);
                    return (
                      <TableRow key={pool.id} className="hover:bg-gray-50/50">
                        <TableCell>
                          <div className="font-medium text-gray-900">{pool.name}</div>
                          <code className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                            {pool.network}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 w-full pr-4">
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>{pool.usedIps} used</span>
                              <span>{pool.totalIps - pool.usedIps} free</span>
                            </div>
                            <Progress value={usagePct} className={`h-2 ${usagePct > 85 ? "[&>div]:bg-red-500" : usagePct > 60 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}`} />
                            <div className="text-right text-xs font-medium text-gray-600">{usagePct}%</div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-gray-600">{pool.gateway}</TableCell>
                        <TableCell className="font-mono text-sm text-gray-500">
                          {pool.dns1 || "—"}{pool.dns2 ? <>, <br />{pool.dns2}</> : ""}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {canManageNetwork && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                                onClick={() => setPoolDialog({
                                  open: true, id: pool.id,
                                  initial: {
                                    name: pool.name, network: pool.network, gateway: pool.gateway,
                                    subnetMask: pool.subnetMask, dns1: pool.dns1 ?? "",
                                    dns2: pool.dns2 ?? "", description: pool.description ?? "",
                                  },
                                })}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {canDeleteNetworkRecords && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                                onClick={() => handleDeletePool(pool.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-gray-400">
                      <Route className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No IP pools configured.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── HOTSPOT ───────────────────────────────────────────────────── */}
        <TabsContent value="hotspot" className="mt-6">
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-5">
              <div className="flex items-start gap-4">
                <div className="bg-violet-600 p-2.5 rounded-xl shrink-0">
                  <Wifi className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-violet-900 mb-1">Hotspot Management</h3>
                  <p className="text-sm text-violet-700 mb-3">
                    Each RouterOS router can run its own hotspot with a branded M-Pesa captive portal.
                    Select a router below to configure its hotspot, manage packages, and view voucher history.
                  </p>
                  <p className="text-xs text-violet-500">
                    Features: M-Pesa STK Push payments · Per-session voucher provisioning · Speed tier profiles · MAC auto-login · Walled garden for Safaricom APIs
                  </p>
                </div>
              </div>
            </div>

            {loadingRouters ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : routersData && routersData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {routersData.filter(r => r.routerType === "routeros").map(router => (
                  <div key={router.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-violet-300 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">{router.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">{router.ipAddress}</p>
                        {router.location && <p className="text-xs text-gray-400">{router.location}</p>}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 bg-violet-50 text-violet-700 border-violet-200">
                        RouterOS
                      </Badge>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Link href={`/network/routers/${router.id}/hotspot`}
                        className="flex-1 text-center bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors">
                        Manage Hotspot
                      </Link>
                      <a href={`/hotspot/${router.id}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Portal
                      </a>
                    </div>
                  </div>
                ))}
                {routersData.filter(r => r.routerType !== "routeros").length > 0 && (
                  <div className="col-span-full">
                    <p className="text-xs text-gray-400 text-center py-2">
                      {routersData.filter(r => r.routerType !== "routeros").length} non-RouterOS device(s) not shown — Hotspot is only supported on MikroTik RouterOS
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
                <Wifi className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium mb-1">No RouterOS devices yet</p>
                <p className="text-sm text-gray-400 mb-4">Add a MikroTik router on the Routers tab to enable hotspot management.</p>
                <button
                  className="text-blue-600 text-sm font-medium hover:underline"
                  onClick={() => {
                    const el = document.querySelector<HTMLButtonElement>('[data-value="routers"]') ?? document.querySelector<HTMLButtonElement>('[value="routers"]');
                    el?.click();
                  }}
                >
                  Go to Routers tab →
                </button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TRAFFIC ANALYSIS ────────────────────────────────────────────── */}
        <TabsContent value="traffic" className="mt-6 space-y-5">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              {(["Today","7D","30D","3M"] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setTrafRange(r)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                    trafRange === r ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >{r}</button>
              ))}
            </div>
            <select
              value={trafRouter}
              onChange={e => setTrafRouter(e.target.value)}
              className="border border-gray-200 rounded-md px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Routers</option>
              {(routersData ?? []).filter(r => r.routerType === "routeros").map(r => (
                <option key={r.id} value={String(r.id)}>{r.name}</option>
              ))}
            </select>
            <button
              onClick={() => fetchTraffic(trafRange, trafRouter)}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 bg-white rounded-md px-2.5 py-1.5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTraf ? "animate-spin" : ""}`} /> Refresh
            </button>
            <p className="ml-auto text-xs text-gray-400">
              DNS cache polled every 5 min from RouterOS devices
            </p>
          </div>

          {!trafData || (trafData.topDomains.length === 0 && trafData.categoryTotals.length === 0) ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
              <Globe className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No traffic data yet</p>
              <p className="text-sm text-gray-400 mt-1">
                DNS observations are collected automatically from RouterOS devices every 5 minutes.<br />
                Data will appear here after the first poll cycle.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

              {/* Category breakdown pie + bar */}
              <div className="xl:col-span-1 space-y-5">
                {/* Pie chart */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                  <h3 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" /> Traffic by Category
                  </h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={trafData.categoryTotals}
                        dataKey="totalHits"
                        nameKey="category"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ category, percent }) =>
                          percent > 0.04 ? `${category} ${(percent * 100).toFixed(0)}%` : ""
                        }
                        labelLine={false}
                      >
                        {trafData.categoryTotals.map(entry => (
                          <Cell
                            key={entry.category}
                            fill={CAT_COLORS[entry.category] ?? "#9ca3af"}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) => [v.toLocaleString(), name]}
                        contentStyle={{ fontSize: 11 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend */}
                  <div className="mt-3 space-y-1">
                    {trafData.categoryTotals.slice(0, 8).map(c => (
                      <div key={c.category} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ background: CAT_COLORS[c.category] ?? "#9ca3af" }}
                          />
                          <span className="capitalize text-gray-700">{c.category}</span>
                          <span className="text-gray-400">({c.uniqueDomains} sites)</span>
                        </div>
                        <span className="font-medium text-gray-600">{c.totalHits.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Daily trend bar chart */}
                {trafData.dailyTrend.length > 1 && (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                    <h3 className="font-semibold text-gray-900 text-sm mb-4">Daily Activity</h3>
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={trafData.dailyTrend} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 9 }} />
                        <Tooltip
                          formatter={(v: number, name: string) => [v.toLocaleString(), name === "totalHits" ? "DNS queries" : "Unique domains"]}
                          contentStyle={{ fontSize: 11 }}
                        />
                        <Bar dataKey="totalHits" name="DNS queries" fill="#3b82f6" radius={[2,2,0,0]} />
                        <Bar dataKey="uniqueDomains" name="Unique domains" fill="#10b981" radius={[2,2,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Top domains table */}
              <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-500" /> Top Domains
                  </h3>
                  <span className="text-xs text-gray-400">{trafData.topDomains.length} domains</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-left text-[11px] text-gray-500 uppercase">
                        <th className="px-4 py-3 font-medium w-8">#</th>
                        <th className="px-4 py-3 font-medium">Domain</th>
                        <th className="px-4 py-3 font-medium">Category</th>
                        <th className="px-4 py-3 font-medium text-right">Hits</th>
                        <th className="px-4 py-3 font-medium text-right">Bar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trafData.topDomains.map((d, i) => {
                        const maxHits = trafData.topDomains[0]?.totalHits ?? 1;
                        const pct = Math.round((d.totalHits / maxHits) * 100);
                        return (
                          <tr key={d.domain} className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
                            <td className="px-4 py-2.5 text-gray-400 font-mono">{i + 1}</td>
                            <td className="px-4 py-2.5 font-mono text-gray-800 truncate max-w-[220px]">{d.domain}</td>
                            <td className="px-4 py-2.5">
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium capitalize"
                                style={{
                                  background: (CAT_COLORS[d.category] ?? "#9ca3af") + "22",
                                  color: CAT_COLORS[d.category] ?? "#6b7280",
                                }}
                              >
                                {d.category}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium text-gray-700">{d.totalHits.toLocaleString()}</td>
                            <td className="px-4 py-2.5 w-28">
                              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${pct}%`,
                                    background: CAT_COLORS[d.category] ?? "#9ca3af",
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <RouterDialog
        key={routerDialog.open ? (routerDialog.id ?? "new") : "closed"}
        open={routerDialog.open}
        onClose={() => setRouterDialog({ open: false })}
        initial={routerDialog.initial}
        routerId={routerDialog.id}
      />
      <EquipmentDialog
        key={equipDialog.open ? (equipDialog.id ?? "new") : "closed"}
        open={equipDialog.open}
        onClose={() => setEquipDialog({ open: false })}
        initial={equipDialog.initial}
        equipmentId={equipDialog.id}
      />
      <IpPoolDialog
        key={poolDialog.open ? (poolDialog.id ?? "new") : "closed"}
        open={poolDialog.open}
        onClose={() => setPoolDialog({ open: false })}
        initial={poolDialog.initial}
        poolId={poolDialog.id}
      />
    </div>
  );
}
