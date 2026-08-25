import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "wouter";
import { useGetRouterRosLive, useGetRouter } from "@workspace/api-client-react";
import {
  ArrowLeft, RefreshCw, Wifi, Activity, Users, Server, HardDrive,
  Clock, AlertTriangle, CheckCircle2, XCircle, Terminal, Layers,
  Network, Cpu, MemoryStick, Radio, Settings, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RouterCommandConsole } from "@/components/router-command-console";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";

// ── Utility helpers ─────────────────────────────────────────────────────────

function fmtBytes(n: number | string | undefined): string {
  const v = typeof n === "string" ? parseInt(n, 10) : (n ?? 0);
  if (isNaN(v)) return "—";
  if (v >= 1e12) return (v / 1e12).toFixed(2) + " TB";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + " GB";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + " MB";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + " KB";
  return v + " B";
}

function fmtBps(bps: number): string {
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Gbps";
  if (bps >= 1e6) return (bps / 1e6).toFixed(2) + " Mbps";
  if (bps >= 1e3) return (bps / 1e3).toFixed(1) + " Kbps";
  return bps.toFixed(0) + " bps";
}

function parseUptime(s: string | undefined): string {
  if (!s) return "—";
  return s.replace(/(\d+)w/, "$1w ").replace(/(\d+)d/, "$1d ").replace(/(\d+)h/, "$1h ").replace(/(\d+)m/, "$1m ").replace(/(\d+)s/, "$1s").trim();
}

function pct(used: number | string, total: number | string): number {
  const u = typeof used === "string" ? parseInt(used, 10) : used;
  const t = typeof total === "string" ? parseInt(total, 10) : total;
  if (!t) return 0;
  return Math.round(((t - u) / t) * 100);
}

function memUsePct(freeB: string | number, totalB: string | number): number {
  const f = typeof freeB === "string" ? parseInt(freeB, 10) : (freeB ?? 0);
  const t = typeof totalB === "string" ? parseInt(totalB, 10) : (totalB ?? 1);
  return Math.round(((t - f) / t) * 100);
}

function cpuBar(load: string | number): number {
  return typeof load === "string" ? parseInt(load, 10) || 0 : (load ?? 0);
}

// ── Sub-components ──────────────────────────────────────────────────────────

function GaugeBar({ label, value, pct: p, color }: { label: string; value: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-500 font-medium">{label}</span>
        <span className="font-mono font-semibold text-gray-800">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${Math.min(p, 100)}%` }} />
      </div>
      <div className="text-right text-xs text-gray-400 mt-0.5">{p}%</div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`bg-white rounded-xl border p-4 flex items-center gap-4 ${color}`}>
      <div className="p-2 rounded-lg bg-white/70">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</div>
        <div className="text-xl font-bold text-gray-900 truncate">{value}</div>
        {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: Record<string, string> }) {
  const topics = entry.topics ?? "";
  const msg = entry.message ?? "";
  const time = entry.time ?? "";
  const isErr = topics.includes("error") || topics.includes("critical");
  const isWarn = topics.includes("warning");
  const isInfo = topics.includes("info");
  return (
    <div className={`flex items-start gap-3 py-1.5 px-3 rounded text-xs font-mono ${isErr ? "bg-red-50 text-red-800" : isWarn ? "bg-yellow-50 text-yellow-800" : "text-gray-700 hover:bg-gray-50"}`}>
      <span className="text-gray-400 shrink-0 w-20">{time}</span>
      <Badge variant="outline" className={`text-[10px] px-1 py-0 shrink-0 ${isErr ? "bg-red-100 text-red-700 border-red-200" : isWarn ? "bg-yellow-100 text-yellow-700 border-yellow-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
        {topics.split(",")[0]}
      </Badge>
      <span className="flex-1 break-words">{msg}</span>
    </div>
  );
}

type TrafficPoint = { time: string; txBps: number; rxBps: number };

// ── Main Component ──────────────────────────────────────────────────────────

export default function RouterOSDashboard() {
  const { id } = useParams();
  const routerId = parseInt(id || "0", 10);

  const { data: routerMeta } = useGetRouter(routerId);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const { data, isLoading, isFetching, refetch } = useGetRouterRosLive(routerId);

  // Manual + auto refresh
  const manualRefresh = useCallback(() => {
    refetch();
    setRefreshKey(k => k + 1);
  }, [refetch]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { refetch(); setRefreshKey(k => k + 1); }, 7000);
    return () => clearInterval(t);
  }, [autoRefresh, refetch]);

  useEffect(() => { if (data) setLastRefreshed(new Date()); }, [data]);

  // Accumulate traffic history per interface (rolling 60-point window)
  const prevIfaceBytes = useRef<Map<string, { tx: number; rx: number; at: number }>>(new Map());
  const trafficHistory = useRef<Map<string, TrafficPoint[]>>(new Map());

  useEffect(() => {
    if (!data?.interfaces) return;
    const now = Date.now();
    const timeLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    for (const iface of data.interfaces as Record<string, any>[]) {
      const name = iface.name as string;
      const tx = (iface.txBytes as number) ?? 0;
      const rx = (iface.rxBytes as number) ?? 0;
      const prev = prevIfaceBytes.current.get(name);
      if (prev) {
        const dtSec = (now - prev.at) / 1000;
        const txBps = dtSec > 0 ? Math.round(((tx - prev.tx) * 8) / dtSec) : 0;
        const rxBps = dtSec > 0 ? Math.round(((rx - prev.rx) * 8) / dtSec) : 0;
        const hist = trafficHistory.current.get(name) ?? [];
        hist.push({ time: timeLabel, txBps: Math.max(0, txBps), rxBps: Math.max(0, rxBps) });
        if (hist.length > 60) hist.shift();
        trafficHistory.current.set(name, hist);
      }
      prevIfaceBytes.current.set(name, { tx, rx, at: now });
    }
    // trigger re-render
    setRefreshKey(k => k + 1);
  }, [data?.interfaces]);

  const [selectedIface, setSelectedIface] = useState<string | null>(null);

  const interfaces = (data?.interfaces ?? []) as Record<string, any>[];
  const pppoeActive = (data?.pppoeActive ?? []) as Record<string, any>[];
  const dhcpLeases = (data?.dhcpLeases ?? []) as Record<string, any>[];
  const queues = (data?.queues ?? []) as Record<string, any>[];
  const logs = (data?.logs ?? []) as Record<string, any>[];
  const wirelessClients = (data?.wirelessClients ?? []) as Record<string, any>[];
  const ipAddresses = (data?.ipAddresses ?? []) as Record<string, any>[];
  const bgpPeers = (data?.bgpPeers ?? []) as Record<string, any>[];
  const ospfNeighbors = (data?.ospfNeighbors ?? []) as Record<string, any>[];
  const res = (data?.resources ?? {}) as Record<string, any>;
  const identity = (data?.identity ?? {}) as Record<string, any>;

  const cpuLoad = cpuBar(res["cpu-load"] ?? 0);
  const memPct = memUsePct(res["free-memory"] ?? 0, res["total-memory"] ?? 1);
  const diskPct = res["free-hdd-space"] && res["total-hdd-space"]
    ? 100 - pct(res["free-hdd-space"], res["total-hdd-space"])
    : 0;

  const activeIfaces = interfaces.filter(i => i.running && !i.disabled);
  const physicalIfaces = interfaces.filter(i => (i.type === "ether" || i.type === "wlan" || i.type === "bridge") && !i.disabled);
  const totalTxBytes = physicalIfaces.reduce((s, i) => s + ((i.txBytes as number) ?? 0), 0);
  const totalRxBytes = physicalIfaces.reduce((s, i) => s + ((i.rxBytes as number) ?? 0), 0);

  const selectedHistory = selectedIface ? (trafficHistory.current.get(selectedIface) ?? []) : [];

  // combined chart: top-level aggregated traffic
  const aggregateHistory = useRef<TrafficPoint[]>([]);
  useEffect(() => {
    if (!data?.interfaces) return;
    const timeLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    let txTotal = 0; let rxTotal = 0;
    for (const [, hist] of trafficHistory.current.entries()) {
      const last = hist[hist.length - 1];
      if (last) { txTotal += last.txBps; rxTotal += last.rxBps; }
    }
    aggregateHistory.current.push({ time: timeLabel, txBps: txTotal, rxBps: rxTotal });
    if (aggregateHistory.current.length > 60) aggregateHistory.current.shift();
  }, [data?.interfaces]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-1">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="outline" size="icon" asChild className="h-8 w-8 shrink-0">
          <Link href="/network"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900">
              {identity?.name ?? routerMeta?.name ?? "RouterOS Dashboard"}
            </h1>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">RouterOS</Badge>
            {data?.error ? (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs">
                <XCircle className="w-3 h-3 mr-1" /> Unreachable
              </Badge>
            ) : data && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Connected
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-500">
            {routerMeta?.vpnIp ?? routerMeta?.ipAddress} {res?.version ? `· v${res.version}` : ""}
            {res?.["board-name"] ? ` · ${res["board-name"]}` : ""}
            {res?.["architecture-name"] ? ` · ${res["architecture-name"]}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <RouterCommandConsole
            routerId={routerId}
            routerName={routerMeta?.name ?? "RouterOS router"}
            vpnConnected={Boolean(routerMeta?.vpnConnected)}
            sshHostKey={routerMeta?.sshHostKey}
          />
          <Button variant="outline" size="sm" className="gap-1.5 border-orange-200 text-orange-700 hover:bg-orange-50" asChild>
            <Link href={`/network/routers/${routerId}/pppoe`}>
              <Settings className="w-3.5 h-3.5" /> PPPoE Server
            </Link>
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 border-violet-200 text-violet-700 hover:bg-violet-50" asChild>
            <Link href={`/network/routers/${routerId}/hotspot`}>
              <Globe className="w-3.5 h-3.5" /> Hotspot
            </Link>
          </Button>
          <span className="text-xs text-gray-400">
            {lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString()}` : ""}
          </span>
          <Button variant="outline" size="sm" className={`gap-1.5 ${isFetching ? "opacity-60" : ""}`} onClick={manualRefresh}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant={autoRefresh ? "default" : "outline"} size="sm"
            className={autoRefresh ? "bg-blue-600 hover:bg-blue-700 text-white gap-1.5" : "gap-1.5"}
            onClick={() => setAutoRefresh(a => !a)}>
            <Activity className="w-3.5 h-3.5" />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {data?.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-800 text-sm">Cannot connect to RouterOS REST API</p>
            <p className="text-red-700 text-sm mt-1">{data.error}</p>
            <p className="text-red-600 text-xs mt-2">
              Make sure the RouterOS REST API is enabled: <code className="bg-red-100 px-1 rounded">
                /ip service enable www
              </code> and the credentials are correct.
            </p>
          </div>
        </div>
      )}

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={<Cpu className="w-5 h-5 text-blue-600" />}
          label="CPU Load"
          value={`${cpuLoad}%`}
          sub={`Cores: ${res?.["cpu-count"] ?? "—"} · ${res?.["cpu-frequency"] ?? "—"} MHz`}
          color="border-blue-100"
        />
        <StatCard
          icon={<MemoryStick className="w-5 h-5 text-purple-600" />}
          label="Memory"
          value={`${memPct}%`}
          sub={`Free: ${fmtBytes(res?.["free-memory"])} / ${fmtBytes(res?.["total-memory"])}`}
          color="border-purple-100"
        />
        <StatCard
          icon={<Users className="w-5 h-5 text-green-600" />}
          label="PPPoE Sessions"
          value={String(pppoeActive.length)}
          sub={`${activeIfaces.length} active interfaces`}
          color="border-green-100"
        />
        <StatCard
          icon={<Clock className="w-5 h-5 text-orange-600" />}
          label="Uptime"
          value={parseUptime(res?.uptime)?.split(" ").slice(0, 2).join(" ") || "—"}
          sub={parseUptime(res?.uptime)}
          color="border-orange-100"
        />
      </div>

      {/* ── Resource bars ── */}
      {!data?.error && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
          <GaugeBar
            label="CPU Utilisation"
            value={`${cpuLoad}%`}
            pct={cpuLoad}
            color={cpuLoad > 85 ? "bg-red-500" : cpuLoad > 60 ? "bg-orange-400" : "bg-blue-500"}
          />
          <GaugeBar
            label="RAM Usage"
            value={`${fmtBytes(res?.["free-memory"])} free`}
            pct={memPct}
            color={memPct > 85 ? "bg-red-500" : memPct > 60 ? "bg-orange-400" : "bg-purple-500"}
          />
          {diskPct > 0 && (
            <GaugeBar
              label="Storage"
              value={`${fmtBytes(res?.["free-hdd-space"])} free`}
              pct={diskPct}
              color={diskPct > 85 ? "bg-red-500" : diskPct > 60 ? "bg-orange-400" : "bg-emerald-500"}
            />
          )}
        </div>
      )}

      {/* ── Aggregate traffic chart ── */}
      {aggregateHistory.current.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900">Total Throughput</h3>
              <p className="text-xs text-gray-400">Aggregated TX + RX across all physical interfaces</p>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-blue-500 rounded inline-block" /> TX {fmtBps(aggregateHistory.current[aggregateHistory.current.length - 1]?.txBps ?? 0)}</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-1 bg-emerald-500 rounded inline-block" /> RX {fmtBps(aggregateHistory.current[aggregateHistory.current.length - 1]?.rxBps ?? 0)}</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={aggregateHistory.current} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => fmtBps(v)} tick={{ fontSize: 10 }} width={60} />
              <Tooltip formatter={(v: number) => fmtBps(v)} contentStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="txBps" name="TX" stroke="#3b82f6" fill="url(#txGrad)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="rxBps" name="RX" stroke="#10b981" fill="url(#rxGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Tabbed sections ── */}
      <Tabs defaultValue="interfaces" className="w-full">
        <TabsList className="bg-gray-100 flex-wrap h-auto">
          <TabsTrigger value="interfaces" className="data-[state=active]:bg-white gap-1.5">
            <Network className="w-3.5 h-3.5" /> Interfaces <Badge variant="secondary" className="ml-1 text-xs px-1">{interfaces.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="pppoe" className="data-[state=active]:bg-white gap-1.5">
            <Users className="w-3.5 h-3.5" /> PPPoE Clients <Badge variant="secondary" className="ml-1 text-xs px-1">{pppoeActive.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="dhcp" className="data-[state=active]:bg-white gap-1.5">
            <Server className="w-3.5 h-3.5" /> DHCP Leases <Badge variant="secondary" className="ml-1 text-xs px-1">{dhcpLeases.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="queues" className="data-[state=active]:bg-white gap-1.5">
            <Layers className="w-3.5 h-3.5" /> Queues <Badge variant="secondary" className="ml-1 text-xs px-1">{queues.length}</Badge>
          </TabsTrigger>
          {wirelessClients.length > 0 && (
            <TabsTrigger value="wireless" className="data-[state=active]:bg-white gap-1.5">
              <Radio className="w-3.5 h-3.5" /> Wireless <Badge variant="secondary" className="ml-1 text-xs px-1">{wirelessClients.length}</Badge>
            </TabsTrigger>
          )}
          {(bgpPeers.length > 0 || ospfNeighbors.length > 0) && (
            <TabsTrigger value="routing" className="data-[state=active]:bg-white gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Routing
            </TabsTrigger>
          )}
          <TabsTrigger value="ips" className="data-[state=active]:bg-white gap-1.5">
            <HardDrive className="w-3.5 h-3.5" /> IP Addresses <Badge variant="secondary" className="ml-1 text-xs px-1">{ipAddresses.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="logs" className="data-[state=active]:bg-white gap-1.5">
            <Terminal className="w-3.5 h-3.5" /> System Log <Badge variant="secondary" className="ml-1 text-xs px-1">{logs.length}</Badge>
          </TabsTrigger>
        </TabsList>

        {/* ── INTERFACES ── */}
        <TabsContent value="interfaces" className="mt-4">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Interface table */}
            <div className="xl:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900 text-sm">All Interfaces</h3>
                <span className="text-xs text-gray-400">{activeIfaces.length} running / {interfaces.length} total</span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead className="w-6"></TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead className="text-right">TX Total</TableHead>
                      <TableHead className="text-right">RX Total</TableHead>
                      <TableHead className="text-right">TX Rate</TableHead>
                      <TableHead className="text-right">RX Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {interfaces.length > 0 ? interfaces.map((iface, idx) => {
                      const hist = trafficHistory.current.get(iface.name) ?? [];
                      const last = hist[hist.length - 1];
                      const isSelected = selectedIface === iface.name;
                      return (
                        <TableRow key={idx}
                          className={`cursor-pointer transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-gray-50/60"} ${iface.disabled ? "opacity-40" : ""}`}
                          onClick={() => setSelectedIface(isSelected ? null : iface.name)}>
                          <TableCell>
                            <div className={`w-2 h-2 rounded-full ${iface.running ? "bg-green-500" : "bg-red-300"}`} />
                          </TableCell>
                          <TableCell className="font-medium text-gray-900 text-sm">{iface.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs capitalize bg-gray-50">{iface.type}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-500">{iface["mac-address"] || "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-blue-700">{fmtBytes(iface.txBytes)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-emerald-700">{fmtBytes(iface.rxBytes)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-blue-600">{last ? fmtBps(last.txBps) : "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-emerald-600">{last ? fmtBps(last.rxBps) : "—"}</TableCell>
                        </TableRow>
                      );
                    }) : (
                      <TableRow><TableCell colSpan={8} className="h-20 text-center text-gray-400 text-sm">No interfaces found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
            {/* Per-interface traffic chart */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">
                {selectedIface ? `${selectedIface} — Live Traffic` : "Interface Traffic"}
              </h3>
              <p className="text-xs text-gray-400 mb-4">
                {selectedIface ? "Click row again to deselect" : "Click an interface row to plot its live traffic"}
              </p>
              {selectedHistory.length > 1 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={selectedHistory} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={v => fmtBps(v)} tick={{ fontSize: 9 }} width={55} />
                    <Tooltip formatter={(v: number) => fmtBps(v)} contentStyle={{ fontSize: 11 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="txBps" name="TX" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="rxBps" name="RX" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-40 flex flex-col items-center justify-center text-gray-300">
                  <Activity className="w-10 h-10 mb-2" />
                  <p className="text-xs">Collecting data{autoRefresh ? "…" : " (auto-refresh paused)"}</p>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── PPPoE CLIENTS ── */}
        <TabsContent value="pppoe" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Active PPPoE Sessions</h3>
              <span className="text-xs text-gray-400">{pppoeActive.length} sessions</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Username</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Interface</TableHead>
                    <TableHead>Uptime</TableHead>
                    <TableHead className="text-right">TX Total</TableHead>
                    <TableHead className="text-right">RX Total</TableHead>
                    <TableHead className="text-right">TX Pkts</TableHead>
                    <TableHead className="text-right">RX Pkts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pppoeActive.length > 0 ? pppoeActive.map((s, idx) => (
                    <TableRow key={idx} className="hover:bg-gray-50/60">
                      <TableCell className="font-medium text-gray-900 text-sm">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-600">{s.address || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-500">{s.service || "pppoe"}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{s["caller-id"] || s.interface || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-600">{parseUptime(s.uptime)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-blue-700">{fmtBytes(s.txBytes)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-700">{fmtBytes(s.rxBytes)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-gray-500">{s.txPackets?.toLocaleString() || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-gray-500">{s.rxPackets?.toLocaleString() || "—"}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={9} className="h-24 text-center text-gray-400 text-sm">
                      {data?.error ? "Cannot connect to router" : "No active PPPoE sessions"}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* PPPoE usage chart */}
          {pppoeActive.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 mt-4">
              <h3 className="font-semibold text-gray-900 text-sm mb-1">Session Data Usage (Top 20)</h3>
              <p className="text-xs text-gray-400 mb-4">Cumulative bytes since session start · sorted by highest usage</p>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={pppoeActive
                    .map(s => ({ name: s.name, tx: (s.txBytes as number) ?? 0, rx: (s.rxBytes as number) ?? 0 }))
                    .sort((a, b) => (b.tx + b.rx) - (a.tx + a.rx))
                    .slice(0, 20)}
                  margin={{ top: 4, right: 8, left: 0, bottom: 50 }}
                  barCategoryGap="25%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tickFormatter={v => fmtBytes(v)} tick={{ fontSize: 9 }} width={65} />
                  <Tooltip
                    formatter={(v: number, name: string) => [fmtBytes(v), name === "tx" ? "TX (Upload)" : "RX (Download)"]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Legend
                    formatter={name => name === "tx" ? "TX Bytes (Upload)" : "RX Bytes (Download)"}
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                  />
                  <Bar dataKey="tx" name="tx" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="rx" name="rx" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </TabsContent>

        {/* ── DHCP LEASES ── */}
        <TabsContent value="dhcp" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">DHCP Leases</h3>
              <span className="text-xs text-gray-400">{dhcpLeases.length} leases · {dhcpLeases.filter(l => l.status === "bound").length} bound</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead>Hostname</TableHead>
                    <TableHead>IP Address</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Expires In</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dhcpLeases.length > 0 ? dhcpLeases.map((lease, idx) => (
                    <TableRow key={idx} className="hover:bg-gray-50/60">
                      <TableCell className="font-medium text-gray-900 text-sm">{lease.hostname || lease["host-name"] || "—"}</TableCell>
                      <TableCell className="font-mono text-sm text-gray-700">{lease.address}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{lease["mac-address"]}</TableCell>
                      <TableCell className="text-xs text-gray-500">{lease.server || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-600">{parseUptime(lease["expires-after"])}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs capitalize ${lease.status === "bound" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-50 text-gray-500"}`}>
                          {lease.status || "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={6} className="h-24 text-center text-gray-400 text-sm">
                      {data?.error ? "Cannot connect to router" : "No DHCP leases found"}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── QUEUES ── */}
        <TabsContent value="queues" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Simple Queues</h3>
              <span className="text-xs text-gray-400">{queues.length} rules</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Max Limit</TableHead>
                    <TableHead className="text-right">TX Bytes</TableHead>
                    <TableHead className="text-right">RX Bytes</TableHead>
                    <TableHead className="text-right">TX Dropped</TableHead>
                    <TableHead className="text-right">RX Dropped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queues.length > 0 ? queues.map((q: Record<string, any>, idx) => (
                    <TableRow key={idx} className={`hover:bg-gray-50/60 ${q.disabled === "true" || q.disabled === true ? "opacity-40" : ""}`}>
                      <TableCell>
                        <div className={`w-2 h-2 rounded-full ${q.disabled === "true" || q.disabled === true ? "bg-gray-300" : "bg-green-500"}`} />
                      </TableCell>
                      <TableCell className="font-medium text-gray-900 text-sm">{q.name}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-600">{q.target || "—"}</TableCell>
                      <TableCell className="text-xs text-gray-600">{q["max-limit"] || "unlimited"}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-blue-700">{fmtBytes(q["bytes"]?.split("/")[0] ?? q.bytes)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-700">{fmtBytes(q["bytes"]?.split("/")[1] ?? "0")}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-500">{q["dropped"]?.split("/")[0] ?? q.dropped ?? "0"}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-400">{q["dropped"]?.split("/")[1] ?? "0"}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={8} className="h-24 text-center text-gray-400 text-sm">
                      {data?.error ? "Cannot connect to router" : "No queues configured"}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── WIRELESS ── */}
        {wirelessClients.length > 0 && (
          <TabsContent value="wireless" className="mt-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm">Wireless Clients ({wirelessClients.length})</h3>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>MAC Address</TableHead>
                      <TableHead>Interface</TableHead>
                      <TableHead>Signal (dBm)</TableHead>
                      <TableHead>TX Rate</TableHead>
                      <TableHead>RX Rate</TableHead>
                      <TableHead>Uptime</TableHead>
                      <TableHead>Comment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wirelessClients.map((c: Record<string, any>, idx) => (
                      <TableRow key={idx} className="hover:bg-gray-50/60">
                        <TableCell className="font-mono text-xs">{c["mac-address"]}</TableCell>
                        <TableCell className="text-xs">{c.interface}</TableCell>
                        <TableCell className="font-mono text-xs">{c["signal-strength"]}</TableCell>
                        <TableCell className="font-mono text-xs">{c["tx-rate"] || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{c["rx-rate"] || "—"}</TableCell>
                        <TableCell className="text-xs">{parseUptime(c.uptime)}</TableCell>
                        <TableCell className="text-xs text-gray-500">{c.comment || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </TabsContent>
        )}

        {/* ── ROUTING ── */}
        {(bgpPeers.length > 0 || ospfNeighbors.length > 0) && (
          <TabsContent value="routing" className="mt-4 space-y-4">
            {bgpPeers.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm">BGP Peers ({bgpPeers.length})</h3>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Remote Address</TableHead>
                        <TableHead>Remote AS</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Uptime</TableHead>
                        <TableHead className="text-right">Prefixes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bgpPeers.map((p: Record<string, any>, idx) => (
                        <TableRow key={idx} className="hover:bg-gray-50/60">
                          <TableCell>
                            <div className={`w-2 h-2 rounded-full ${p.state === "established" ? "bg-green-500" : "bg-red-400"}`} />
                          </TableCell>
                          <TableCell className="font-medium text-sm">{p.name}</TableCell>
                          <TableCell className="font-mono text-xs">{p["remote-address"]}</TableCell>
                          <TableCell className="font-mono text-xs">{p["remote-as"]}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs capitalize ${p.state === "established" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-600 border-red-200"}`}>{p.state}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{parseUptime(p.uptime)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{p["prefix-count"] ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            {ospfNeighbors.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-900 text-sm">OSPF Neighbors ({ospfNeighbors.length})</h3>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead></TableHead>
                        <TableHead>Router ID</TableHead>
                        <TableHead>Address</TableHead>
                        <TableHead>Interface</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Priority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ospfNeighbors.map((n: Record<string, any>, idx) => (
                        <TableRow key={idx} className="hover:bg-gray-50/60">
                          <TableCell>
                            <div className={`w-2 h-2 rounded-full ${n.state === "Full" ? "bg-green-500" : "bg-orange-400"}`} />
                          </TableCell>
                          <TableCell className="font-mono text-xs">{n["router-id"]}</TableCell>
                          <TableCell className="font-mono text-xs">{n.address}</TableCell>
                          <TableCell className="text-xs">{n.interface}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-xs ${n.state === "Full" ? "bg-green-50 text-green-700 border-green-200" : "bg-orange-50 text-orange-700 border-orange-200"}`}>{n.state}</Badge>
                          </TableCell>
                          <TableCell className="text-xs">{n.priority}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        )}

        {/* ── IP ADDRESSES ── */}
        <TabsContent value="ips" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">Assigned IP Addresses</h3>
              <span className="text-xs text-gray-400">{ipAddresses.length} entries</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-50">
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Address / Prefix</TableHead>
                    <TableHead>Network</TableHead>
                    <TableHead>Interface</TableHead>
                    <TableHead>Comment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ipAddresses.length > 0 ? ipAddresses.map((a: Record<string, any>, idx) => (
                    <TableRow key={idx} className={`hover:bg-gray-50/60 ${a.disabled === "true" || a.disabled === true ? "opacity-40" : ""}`}>
                      <TableCell>
                        <div className={`w-2 h-2 rounded-full ${a.disabled === "true" || a.disabled === true ? "bg-gray-300" : a.invalid === "true" ? "bg-red-400" : "bg-green-500"}`} />
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium text-gray-900">{a.address}</TableCell>
                      <TableCell className="font-mono text-xs text-gray-500">{a.network}</TableCell>
                      <TableCell className="text-sm text-gray-700">{a.interface}</TableCell>
                      <TableCell className="text-xs text-gray-400">{a.comment || "—"}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={5} className="h-20 text-center text-gray-400 text-sm">No IP addresses found</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>

        {/* ── SYSTEM LOG ── */}
        <TabsContent value="logs" className="mt-4">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 text-sm">System Log</h3>
              <span className="text-xs text-gray-400">Last {logs.length} entries</span>
            </div>
            <div className="max-h-[500px] overflow-y-auto divide-y divide-gray-100">
              {logs.length > 0 ? (
                [...logs].reverse().map((entry: Record<string, any>, idx) => (
                  <LogLine key={idx} entry={entry} />
                ))
              ) : (
                <div className="h-24 flex items-center justify-center text-gray-400 text-sm">
                  {data?.error ? "Cannot connect to router" : "No log entries"}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
