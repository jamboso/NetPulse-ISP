import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Wifi, WifiOff, Cpu, MemoryStick, Clock, AlertTriangle,
  RefreshCw, Activity, Users, Server, Zap, ChevronDown,
  ChevronUp, CheckCircle2, Circle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ──────────────────────────────────────────────────────────────────────

interface RouterStat {
  id: number;
  name: string;
  ipAddress: string;
  location: string | null;
  routerType: string;
  enabled: boolean;
  online: boolean;
  cpu: number | null;
  memory: number | null;
  uptime: string | null;
  version: string | null;
  model: string | null;
  lastSeen: string | null;
}

interface OnuEvent {
  routerName: string;
  bucket: string;
  count: number;
  usernames: string[];
}

interface FlappingAccount {
  customerId: number;
  customerName: string;
  pppoeUsername: string;
  routerName: string | null;
  sessionCount: number;
  lastSeen: string;
}

interface MonitoringData {
  fetchedAt: string;
  summary: {
    totalRouters: number;
    onlineRouters: number;
    offlineRouters: number;
    onuEvents: number;
    flappingAccounts: number;
  };
  routers: RouterStat[];
  onuEvents: OnuEvent[];
  flappingAccounts: FlappingAccount[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function elapsed(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function cpuColor(v: number) {
  if (v > 85) return "text-red-500";
  if (v > 65) return "text-orange-500";
  return "text-green-600";
}

function memColor(v: number) {
  if (v > 90) return "text-red-500";
  if (v > 75) return "text-orange-500";
  return "text-green-600";
}

function progressColor(v: number) {
  if (v > 85) return "bg-red-500";
  if (v > 65) return "bg-orange-400";
  return "bg-green-500";
}

function timeSince(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Router Card ───────────────────────────────────────────────────────────────

function RouterCard({ r }: { r: RouterStat }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden transition-all ${!r.enabled ? "opacity-50" : ""}`}>
      {/* Status stripe */}
      <div className={`h-1 w-full ${r.online ? "bg-green-500" : r.enabled ? "bg-red-500" : "bg-gray-300"}`} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${r.online ? "bg-green-50" : "bg-red-50"}`}>
              {r.online
                ? <Wifi className="w-5 h-5 text-green-600" />
                : <WifiOff className="w-5 h-5 text-red-500" />
              }
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{r.name}</p>
              <p className="text-xs text-gray-400 font-mono truncate">{r.ipAddress}</p>
              {r.location && <p className="text-xs text-gray-400 truncate">{r.location}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={r.online ? "default" : "destructive"} className={r.online ? "bg-green-500" : ""}>
              {r.online ? "Online" : r.enabled ? "Offline" : "Disabled"}
            </Badge>
            {r.routerType === "routeros" && r.enabled && (
              <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Quick stats row */}
        {r.online && (
          <div className="mt-3 grid grid-cols-3 gap-3">
            {r.cpu !== null && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><Cpu className="w-3 h-3" />CPU</span>
                  <span className={`text-xs font-bold ${cpuColor(r.cpu)}`}>{r.cpu}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${progressColor(r.cpu)}`} style={{ width: `${r.cpu}%` }} />
                </div>
              </div>
            )}
            {r.memory !== null && (
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500 flex items-center gap-1"><MemoryStick className="w-3 h-3" />RAM</span>
                  <span className={`text-xs font-bold ${memColor(r.memory)}`}>{r.memory}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${progressColor(r.memory)}`} style={{ width: `${r.memory}%` }} />
                </div>
              </div>
            )}
            {r.uptime && (
              <div>
                <span className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" />Uptime</span>
                <span className="text-xs font-semibold text-gray-700">{r.uptime}</span>
              </div>
            )}
          </div>
        )}

        {/* Expanded detail */}
        {expanded && r.online && (
          <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-2 text-xs">
            {r.model   && <div><span className="text-gray-400">Model</span><br /><span className="font-medium">{r.model}</span></div>}
            {r.version && <div><span className="text-gray-400">ROS Version</span><br /><span className="font-medium">{r.version}</span></div>}
            <div className="col-span-2 flex gap-2 mt-1">
              <Link href={`/network/routers/${r.id}`}>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                  <Activity className="w-3 h-3" /> Live Dashboard
                </Button>
              </Link>
            </div>
          </div>
        )}

        {/* Offline detail */}
        {!r.online && r.enabled && r.lastSeen && (
          <p className="mt-2 text-xs text-red-400">Last seen {timeSince(r.lastSeen)}</p>
        )}
        {!r.online && r.enabled && !r.lastSeen && (
          <p className="mt-2 text-xs text-gray-400">Never connected</p>
        )}
      </div>
    </div>
  );
}

// ── ONU Event Row ─────────────────────────────────────────────────────────────

function OnuEventRow({ ev }: { ev: OnuEvent }) {
  const [expanded, setExpanded] = useState(false);
  const age = timeSince(ev.bucket);
  const isRecent = Date.now() - new Date(ev.bucket).getTime() < 60 * 60 * 1000;

  return (
    <div className={`rounded-lg border p-3 ${isRecent ? "border-red-300 bg-red-50" : "border-orange-200 bg-orange-50"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${isRecent ? "text-red-500" : "text-orange-500"}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">
              {ev.count} clients disconnected simultaneously — {ev.routerName}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {new Date(ev.bucket).toLocaleString("en-KE")} · {age}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge className={isRecent ? "bg-red-500 text-white" : "bg-orange-400 text-white"}>
            {isRecent ? "Recent" : "Past 24h"}
          </Badge>
          <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {expanded && ev.usernames.length > 0 && (
        <div className="mt-2 pt-2 border-t border-orange-200">
          <p className="text-xs font-semibold text-gray-600 mb-1">Affected accounts:</p>
          <div className="flex flex-wrap gap-1">
            {ev.usernames.map(u => (
              <span key={u} className="font-mono text-xs bg-white border border-orange-200 rounded px-1.5 py-0.5 text-gray-700">{u}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Flapping Row ──────────────────────────────────────────────────────────────

function FlappingRow({ a }: { a: FlappingAccount }) {
  const severity = a.sessionCount >= 15 ? "high" : a.sessionCount >= 10 ? "medium" : "low";
  const colors = {
    high:   "border-red-300 bg-red-50",
    medium: "border-orange-200 bg-orange-50",
    low:    "border-yellow-200 bg-yellow-50",
  };
  const badgeColors = {
    high:   "bg-red-500 text-white",
    medium: "bg-orange-400 text-white",
    low:    "bg-yellow-400 text-gray-800",
  };

  return (
    <div className={`rounded-lg border p-3 flex items-center gap-3 ${colors[severity]}`}>
      <Zap className={`w-4 h-4 shrink-0 ${severity === "high" ? "text-red-500" : severity === "medium" ? "text-orange-500" : "text-yellow-600"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/customers/${a.customerId}`}>
            <span className="text-sm font-semibold text-blue-600 hover:underline cursor-pointer">{a.customerName}</span>
          </Link>
          <span className="font-mono text-xs text-gray-500">{a.pppoeUsername}</span>
          {a.routerName && <span className="text-xs text-gray-400">· {a.routerName}</span>}
        </div>
        <p className="text-xs text-gray-500 mt-0.5">Last event {timeSince(a.lastSeen)}</p>
      </div>
      <Badge className={badgeColors[severity]}>
        {a.sessionCount} sessions / 24h
      </Badge>
    </div>
  );
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number | string; color: string;
}) {
  return (
    <div className="rounded-xl border bg-white shadow-sm p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 leading-none">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Monitoring() {
  const [onuThreshold,  setOnuThreshold]  = useState(5);
  const [flapThreshold, setFlapThreshold] = useState(5);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<MonitoringData>({
    queryKey: ["monitoring", onuThreshold, flapThreshold],
    queryFn: async () => {
      const r = await fetch(`${API}/api/monitoring/overview?onu_threshold=${onuThreshold}&flap_threshold=${flapThreshold}`);
      return r.json();
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const onlineRouters  = data?.routers.filter(r => r.online) ?? [];
  const offlineRouters = data?.routers.filter(r => !r.online && r.enabled) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Real-time router health · ONU failure detection · Account flapping alerts
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-gray-400">Updated {elapsed(new Date(dataUpdatedAt).toISOString())}</span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Summary strip */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard icon={Server}       label="Total Routers"       value={data.summary.totalRouters}     color="bg-blue-50 text-blue-600" />
          <SummaryCard icon={CheckCircle2} label="Online"              value={data.summary.onlineRouters}    color="bg-green-50 text-green-600" />
          <SummaryCard icon={AlertTriangle} label="ONU Failure Events" value={data.summary.onuEvents}        color="bg-orange-50 text-orange-600" />
          <SummaryCard icon={Zap}          label="Flapping Accounts"   value={data.summary.flappingAccounts} color="bg-red-50 text-red-500" />
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-gray-400 gap-3">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Pinging routers…</span>
        </div>
      )}

      {data && (
        <>
          {/* ── Router Status ────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Server className="w-4 h-4 text-gray-500" />
                Router Status
              </h2>
              <div className="flex items-center gap-2 ml-auto text-xs text-gray-500">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{onlineRouters.length} online</span>
                {offlineRouters.length > 0 && (
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{offlineRouters.length} offline</span>
                )}
              </div>
            </div>

            {data.routers.length === 0 ? (
              <div className="rounded-xl border bg-white p-10 text-center text-gray-400">
                <Server className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <p className="font-semibold">No routers configured</p>
                <p className="text-sm mt-1">Add routers in the Network section to start monitoring.</p>
                <Link href="/network">
                  <Button size="sm" variant="outline" className="mt-3">Go to Network</Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {/* Offline first to draw attention */}
                {[...offlineRouters, ...onlineRouters, ...(data.routers.filter(r => !r.enabled))].map(r => (
                  <RouterCard key={r.id} r={r} />
                ))}
              </div>
            )}
          </section>

          {/* ── ONU / Mass Disconnect Alerts ─────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" />
                ONU / Mass Disconnect Events
                <span className="text-xs font-normal text-gray-400">— last 24 hours</span>
              </h2>
              <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                Threshold:
                <select
                  value={onuThreshold}
                  onChange={e => setOnuThreshold(parseInt(e.target.value))}
                  className="border rounded px-1.5 py-0.5 text-xs"
                >
                  {[3,4,5,6,8,10].map(n => <option key={n} value={n}>≥{n} clients</option>)}
                </select>
              </div>
            </div>

            {data.onuEvents.length === 0 ? (
              <div className="rounded-xl border bg-white p-6 text-center">
                <CheckCircle2 className="w-8 h-8 mx-auto text-green-400 mb-2" />
                <p className="text-sm font-semibold text-gray-600">No mass disconnect events in the last 24 hours</p>
                <p className="text-xs text-gray-400 mt-1">Events are triggered when ≥{onuThreshold} clients disconnect within the same 5-minute window.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.onuEvents.map((ev, i) => <OnuEventRow key={i} ev={ev} />)}
              </div>
            )}
          </section>

          {/* ── Account Flapping ──────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-500" />
                Constant On/Off — Account Flapping
                <span className="text-xs font-normal text-gray-400">— last 24 hours</span>
              </h2>
              <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
                Threshold:
                <select
                  value={flapThreshold}
                  onChange={e => setFlapThreshold(parseInt(e.target.value))}
                  className="border rounded px-1.5 py-0.5 text-xs"
                >
                  {[3,5,8,10,15,20].map(n => <option key={n} value={n}>&gt;{n} sessions</option>)}
                </select>
              </div>
            </div>

            {data.flappingAccounts.length === 0 ? (
              <div className="rounded-xl border bg-white p-6 text-center">
                <CheckCircle2 className="w-8 h-8 mx-auto text-green-400 mb-2" />
                <p className="text-sm font-semibold text-gray-600">No flapping accounts detected</p>
                <p className="text-xs text-gray-400 mt-1">Accounts with more than {flapThreshold} connect/disconnect cycles in 24 hours will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.flappingAccounts.map((a, i) => <FlappingRow key={i} a={a} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
