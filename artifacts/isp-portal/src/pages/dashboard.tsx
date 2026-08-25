import { useGetDashboardSummary, useGetRevenueStats, useGetSubscriptionBreakdown, useGetRecentActivity, useGetRoutersStatus, useGetSecurityEventsSummary, useListSecurityEvents, useClearSecurityEvents, getExportSecurityEventsCsvUrl, useListBlockedIps, useUnblockIp, type RouterStatus } from "@workspace/api-client-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useEffect, useRef, useState } from "react";
import {
  Users, CreditCard, AlertTriangle, DollarSign, LifeBuoy,
  ServerCrash, Activity, Wifi, WifiOff, RefreshCw, Clock,
  ShieldAlert, ShieldCheck, Zap, Download, Trash2, Ban, Unlock, Terminal,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/formatDate";
import { formatDistanceToNow, isValid } from "date-fns";
import { Link } from "wouter";
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";

const ROUTER_TYPE_LABELS: Record<string, string> = {
  routeros: "RouterOS",
  juniper: "JunOS",
  edgerouter: "EdgeRouter",
};

const ROUTER_TYPE_COLORS: Record<string, string> = {
  routeros: "bg-blue-50 text-blue-700 border-blue-200",
  juniper: "bg-orange-50 text-orange-700 border-orange-200",
  edgerouter: "bg-purple-50 text-purple-700 border-purple-200",
};

function BlockedCallbackPanel() {
  const { data: summary, isLoading: loadingSummary, refetch: refetchSummary } = useGetSecurityEventsSummary();
  const { data: events, isLoading: loadingEvents, refetch: refetchEvents } = useListSecurityEvents({ limit: 10 });
  const { data: blockedIpsData, isLoading: loadingBlocked, refetch: refetchBlocked } = useListBlockedIps();
  const clearMutation = useClearSecurityEvents();
  const unblockMutation = useUnblockIp();

  const [confirmClear, setConfirmClear] = useState(false);
  const [retentionDays, setRetentionDays] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [unblockingIp, setUnblockingIp] = useState<string | null>(null);

  function handleUnblock(ip: string) {
    setUnblockingIp(ip);
    unblockMutation.mutate(
      { ip },
      {
        onSettled: () => {
          setUnblockingIp(null);
          refetchBlocked();
        },
      }
    );
  }

  const count = summary?.blockedLast24h ?? 0;
  const threshold = summary?.threshold ?? 5;
  const totalCount = summary?.totalCount ?? 0;
  const isAlert = count >= threshold;

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch(getExportSecurityEventsCsvUrl(), { credentials: "include" });
      if (!res.ok) {
        console.error("Export failed:", res.status, await res.text());
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? `security-events-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function handleClearConfirmed() {
    clearMutation.mutate(
      { params: retentionDays > 0 ? { retentionDays } : undefined },
      {
        onSuccess: () => {
          setConfirmClear(false);
          refetchSummary();
          refetchEvents();
        },
      }
    );
  }

  return (
    <div className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isAlert ? "border-red-300" : "border-gray-200"}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-4 border-b ${isAlert ? "border-red-200 bg-red-50" : "border-gray-200"}`}>
        <div className="flex items-center gap-2.5 flex-wrap">
          {isAlert ? (
            <ShieldAlert className="w-5 h-5 text-red-600" />
          ) : (
            <ShieldCheck className="w-5 h-5 text-green-600" />
          )}
          <h3 className="text-base font-semibold text-gray-900">Blocked Webhook Attempts</h3>
          {!loadingSummary && (
            <Badge
              variant="outline"
              className={`text-xs px-1.5 py-0 ${isAlert ? "bg-red-100 text-red-700 border-red-300" : "bg-green-50 text-green-700 border-green-200"}`}
            >
              {count} in last 24h
            </Badge>
          )}
          {!loadingSummary && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 bg-gray-50 text-gray-600 border-gray-200">
              {totalCount} total
            </Badge>
          )}
          {!loadingSummary && isAlert && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 bg-orange-50 text-orange-700 border-orange-300">
              ⚠ Above threshold
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={handleExport}
            disabled={exporting || totalCount === 0}
            title="Download all events as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
            onClick={() => setConfirmClear(true)}
            disabled={totalCount === 0}
            title="Clear log entries"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {/* Clear confirmation dialog */}
      {confirmClear && (
        <div className="px-5 py-4 bg-red-50 border-b border-red-200 flex flex-col gap-3">
          <p className="text-sm font-medium text-red-800">Clear security event log?</p>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-gray-600 flex items-center gap-2">
              Keep records newer than
              <select
                value={retentionDays}
                onChange={(e) => setRetentionDays(Number(e.target.value))}
                className="text-xs border border-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value={0}>— delete all —</option>
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={handleClearConfirmed}
              disabled={clearMutation.isPending}
            >
              {clearMutation.isPending ? "Clearing…" : "Confirm Clear"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => { setConfirmClear(false); clearMutation.reset(); }}
            >
              Cancel
            </Button>
            {clearMutation.isError && (
              <span className="text-xs text-red-600">Failed to clear. Please try again.</span>
            )}
          </div>
        </div>
      )}

      {/* Body — recent blocked attempts */}
      {loadingEvents ? (
        <div className="p-4 space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded" />)}
        </div>
      ) : !events?.data || events.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <ShieldCheck className="w-10 h-10 mb-2.5 opacity-20" />
          <p className="text-sm font-medium">No blocked attempts recorded</p>
          <p className="text-xs mt-0.5">Forged M-Pesa callback attempts will appear here</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {events.data.map((evt) => (
            <div key={evt.id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <div className="shrink-0 p-1.5 rounded-md bg-red-50">
                <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 font-medium truncate">
                  <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{evt.callerIp}</code>
                  <span className="ml-2 text-gray-500 font-normal">→ {evt.endpoint}</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{evt.reason}</p>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {formatDate(evt.createdAt, "MMM d, h:mm a")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Auto-blocked IPs sub-panel */}
      <div className="border-t border-gray-200">
        <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-orange-600" />
            <span className="text-sm font-medium text-gray-800">Auto-Blocked IPs</span>
            {!loadingBlocked && (blockedIpsData?.data?.length ?? 0) > 0 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 bg-orange-50 text-orange-700 border-orange-300">
                {blockedIpsData!.data.length} active
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-400">Auto-blocks after {summary?.threshold ?? 10} blocked attempts / 1 h → 24 h ban</p>
        </div>

        {loadingBlocked ? (
          <div className="p-4 space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded" />)}
          </div>
        ) : !blockedIpsData?.data || blockedIpsData.data.length === 0 ? (
          <div className="flex items-center gap-2 px-5 py-4 text-gray-400">
            <ShieldCheck className="w-4 h-4 opacity-40" />
            <p className="text-sm">No IPs are currently auto-blocked</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {blockedIpsData.data.map((blocked) => {
              const isUnblocking = unblockingIp === blocked.ip;
              return (
                <div key={blocked.id} className="px-5 py-3 flex items-center gap-4 hover:bg-orange-50/40 transition-colors">
                  <div className="shrink-0 p-1.5 rounded-md bg-orange-50">
                    <Ban className="w-3.5 h-3.5 text-orange-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 font-medium">
                      <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{blocked.ip}</code>
                      <span className="ml-2 text-xs text-gray-400 font-normal">{blocked.attemptCount} attempts</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Expires {formatDistanceToNow(new Date(blocked.expiresAt), { addSuffix: true })}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5 text-orange-700 border-orange-200 hover:bg-orange-50 hover:text-orange-800 shrink-0"
                    onClick={() => handleUnblock(blocked.ip)}
                    disabled={isUnblocking}
                    title="Manually unblock this IP"
                  >
                    <Unlock className="w-3 h-3" />
                    {isUnblocking ? "Unblocking…" : "Unblock"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RouterStatusPanel() {
  const {
    data: routers,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useGetRoutersStatus();

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(() => { refetch(); }, 30_000);
    return () => clearInterval(id);
  }, [refetch]);

  const online = routers?.filter((r) => r.reachable).length ?? 0;
  const total = routers?.length ?? 0;
  const offline = routers?.filter((r) => r.enabled && !r.reachable).length ?? 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Wifi className="w-5 h-5 text-blue-600" />
            {!isLoading && online > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full ring-1 ring-white" />
            )}
          </div>
          <h3 className="text-base font-semibold text-gray-900">Router Status</h3>
          {!isLoading && total > 0 && (
            <div className="flex items-center gap-1.5 ml-1">
              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 px-1.5 py-0">
                {online} online
              </Badge>
              {offline > 0 && (
                <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200 px-1.5 py-0">
                  {offline} offline
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Clock className="w-3 h-3" />
              {(() => { const d = new Date(dataUpdatedAt); return isValid(d) ? formatDistanceToNow(d, { addSuffix: true }) : "—"; })()}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:text-gray-700"
            onClick={() => refetch()}
            title="Refresh now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))}
        </div>
      ) : !routers || routers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-gray-400">
          <Wifi className="w-10 h-10 mb-2.5 opacity-20" />
          <p className="text-sm font-medium">No routers configured yet</p>
          <p className="text-xs mt-0.5">Add routers in Network → Routers</p>
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {routers.map((r) => (
            <RouterCard key={r.id} router={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function RouterCard({ router: r }: { router: RouterStatus }) {
  const statusColor = !r.enabled
    ? "bg-gray-100 border-gray-200"
    : r.reachable
    ? "bg-green-50 border-green-200"
    : "bg-red-50 border-red-200";

  const dotColor = !r.enabled
    ? "bg-gray-300"
    : r.reachable
    ? "bg-green-500"
    : "bg-red-500";

  const dotPulse = r.reachable && r.enabled;

  return (
    <div className={`relative rounded-md border p-3.5 transition-colors ${statusColor}`}>
      {/* Status dot */}
      <span className="absolute top-3 right-3 flex items-center justify-center w-3 h-3">
        {dotPulse && (
          <span className="absolute inline-flex w-3 h-3 rounded-full bg-green-400 opacity-75 animate-ping" />
        )}
        <span className={`relative inline-flex w-2.5 h-2.5 rounded-full ${dotColor}`} />
      </span>

      {/* Name + type */}
      <div className="flex items-start gap-2 pr-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate leading-tight">{r.name}</p>
          {r.location && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{r.location}</p>
          )}
        </div>
      </div>

      {/* Type badge + IP */}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <Badge
          variant="outline"
          className={`text-xs px-1.5 py-0 font-medium ${ROUTER_TYPE_COLORS[r.routerType] ?? "bg-gray-100 text-gray-600"}`}
        >
          {ROUTER_TYPE_LABELS[r.routerType] ?? r.routerType}
        </Badge>
        <code className="text-xs text-gray-500 font-mono bg-white/70 px-1.5 py-0.5 rounded border border-gray-200/80">
          {r.routerType === "routeros" ? (r.vpnIp ?? "VPN pending") : r.ipAddress}{r.routerType !== "routeros" && r.port ? `:${r.port}` : ""}
        </code>
      </div>

      {/* Status line */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        {!r.enabled ? (
          <span className="text-gray-400 flex items-center gap-1">
            <WifiOff className="w-3 h-3" /> Disabled
          </span>
        ) : r.reachable ? (
          <span className="text-green-700 font-medium flex items-center gap-1">
            <Wifi className="w-3 h-3" />
            Online
            {r.latencyMs != null && (
              <span className="text-green-600 font-normal">· {r.latencyMs}ms</span>
            )}
          </span>
        ) : (
          <span className="text-red-600 flex items-center gap-1">
            <WifiOff className="w-3 h-3" /> {r.routerType === "routeros" && !r.vpnConnected ? "VPN pending" : "Unreachable"}
          </span>
        )}
        {r.lastSeen && (
          <span className="text-gray-400 ml-auto truncate">
            {(() => { const d = new Date(r.lastSeen ?? ""); return isValid(d) ? formatDistanceToNow(d, { addSuffix: true }) : "never"; })()}
          </span>
        )}
      </div>
      {r.routerType === "routeros" && (
        <div className="mt-3 border-t border-black/5 pt-2">
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-xs text-blue-700 hover:bg-blue-100" asChild>
            <Link href={`/network/routers/${r.id}`}>
              <Terminal className="mr-1.5 h-3.5 w-3.5" /> Open router
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBps(bps: number): string {
  if (bps >= 1e9) return (bps / 1e9).toFixed(2) + " Gbps";
  if (bps >= 1e6) return (bps / 1e6).toFixed(2) + " Mbps";
  if (bps >= 1e3) return (bps / 1e3).toFixed(1) + " Kbps";
  return bps.toFixed(0) + " bps";
}

type TrafficPoint = { time: string; txBps: number; rxBps: number };
type TrafficIface = { name: string; type: string; running: boolean; disabled: boolean; txBytes: number; rxBytes: number };

// ── Live Network Traffic Widget ────────────────────────────────────────────────

function LiveNetworkWidget({ routers }: { routers: RouterStatus[] }) {
  const rosRouters = routers.filter(r => r.enabled && r.reachable && r.routerType === "routeros");
  const [selectedId, setSelectedId] = useState<number>(rosRouters[0]?.id ?? 0);
  const [currentTx, setCurrentTx] = useState(0);
  const [currentRx, setCurrentRx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const history = useRef<TrafficPoint[]>([]);
  const prevBytes = useRef<{ tx: number; rx: number; at: number } | null>(null);

  // reset history when router changes
  useEffect(() => {
    history.current = [];
    prevBytes.current = null;
    setCurrentTx(0);
    setCurrentRx(0);
    setError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    async function poll() {
      try {
        const r = await fetch(`/api/routers/${selectedId}/ros/traffic`, { credentials: "include" });
        const data = await r.json() as { error: string | null; interfaces: TrafficIface[] };
        if (cancelled) return;
        if (data.error) { setError(data.error); return; }
        setError(null);

        const now = Date.now();
        const timeLabel = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        let totalTx = 0; let totalRx = 0;
        for (const iface of data.interfaces) {
          if (!iface.disabled && (iface.type === "ether" || iface.type === "wlan" || iface.type === "bridge")) {
            totalTx += iface.txBytes;
            totalRx += iface.rxBytes;
          }
        }
        if (prevBytes.current) {
          const dt = (now - prevBytes.current.at) / 1000;
          const txBps = dt > 0 ? Math.round(((totalTx - prevBytes.current.tx) * 8) / dt) : 0;
          const rxBps = dt > 0 ? Math.round(((totalRx - prevBytes.current.rx) * 8) / dt) : 0;
          history.current.push({ time: timeLabel, txBps: Math.max(0, txBps), rxBps: Math.max(0, rxBps) });
          if (history.current.length > 60) history.current.shift();
          setCurrentTx(Math.max(0, txBps));
          setCurrentRx(Math.max(0, rxBps));
          setTick(t => t + 1);
        }
        prevBytes.current = { tx: totalTx, rx: totalRx, at: now };
      } catch { /* router unreachable during poll — skip */ }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [selectedId]);

  if (rosRouters.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2.5">
          <Zap className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-semibold text-gray-900">Live Network Traffic</h3>
          <span className="flex items-center gap-1 text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
            LIVE
          </span>
        </div>
        {rosRouters.length > 1 && (
          <div className="flex gap-1">
            {rosRouters.map(r => (
              <button key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${selectedId === r.id ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pt-4 pb-2">
        {error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : (
          <>
            {/* Speed readouts */}
            <div className="flex gap-6 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-1 bg-blue-500 rounded inline-block" />
                <span className="text-xs text-gray-500">TX</span>
                <span className="text-sm font-bold font-mono text-blue-700">{fmtBps(currentTx)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-1 bg-emerald-500 rounded inline-block" />
                <span className="text-xs text-gray-500">RX</span>
                <span className="text-sm font-bold font-mono text-emerald-700">{fmtBps(currentRx)}</span>
              </div>
              <span className="text-xs text-gray-400 ml-auto self-center">polls every 5s · last 5 min</span>
            </div>

            {history.current.length > 1 ? (
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={history.current} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dashTxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="dashRxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={v => fmtBps(v)} tick={{ fontSize: 9 }} width={56} />
                  <Tooltip formatter={(v: number) => fmtBps(v)} contentStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="txBps" name="TX" stroke="#3b82f6" fill="url(#dashTxGrad)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="rxBps" name="RX" stroke="#10b981" fill="url(#dashRxGrad)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[140px] flex items-center justify-center text-gray-400 text-sm">
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Collecting data…
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: revenueStats, isLoading: loadingRevenue } = useGetRevenueStats();
  const { data: subscriptionBreakdown, isLoading: loadingBreakdown } = useGetSubscriptionBreakdown();
  const { data: recentActivity, isLoading: loadingActivity } = useGetRecentActivity();
  const { data: routers } = useGetRoutersStatus();
  const { fmtMoney, fmtMoneyCompact } = useCurrency();

  const metrics = [
    { label: "Total Customers", value: summary?.totalCustomers, icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Active Subscriptions", value: summary?.activeSubscriptions, icon: CreditCard, color: "text-green-500", bg: "bg-green-50" },
    { label: "Monthly Revenue", value: summary?.monthlyRevenue ? fmtMoney(summary.monthlyRevenue, 0) : undefined, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-50" },
    { label: "Overdue Invoices", value: summary?.overdueInvoices, icon: AlertTriangle, color: "text-red-500", bg: "bg-red-50" },
    { label: "Open Tickets", value: summary?.openTickets, icon: LifeBuoy, color: "text-orange-500", bg: "bg-orange-50" },
    { label: "Total Equipment", value: summary?.totalEquipment, icon: ServerCrash, color: "text-purple-500", bg: "bg-purple-50" },
  ];

  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Command Center</h1>
        <p className="text-gray-500 text-sm">System overview and key performance metrics.</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((metric, i) => {
          const Icon = metric.icon;
          return (
            <div key={i} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex items-center gap-4">
              <div className={`p-3 rounded-md ${metric.bg} ${metric.color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">{metric.label}</p>
                {loadingSummary ? (
                  <Skeleton className="h-7 w-20 mt-1" />
                ) : (
                  <h3 className="text-2xl font-bold text-gray-900">{metric.value || 0}</h3>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Blocked Webhook Attempts */}
      <BlockedCallbackPanel />

      {/* Router Live Status */}
      <RouterStatusPanel />

      {/* Live Network Traffic */}
      {routers && routers.length > 0 && <LiveNetworkWidget routers={routers} />}

      {/* Revenue + Subscription charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Revenue Overview</h3>
          <div className="h-[300px]">
            {loadingRevenue ? (
              <Skeleton className="w-full h-full" />
            ) : revenueStats && revenueStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueStats} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#6b7280", fontSize: 12 }} dy={10} />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#6b7280", fontSize: 12 }}
                    tickFormatter={(value) => fmtMoneyCompact(value)}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    formatter={(value: number) => [fmtMoney(value), "Revenue"]}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: "#3b82f6", strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">No revenue data available</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Subscription Status</h3>
          <div className="h-[300px]">
            {loadingBreakdown ? (
              <Skeleton className="w-full h-full" />
            ) : subscriptionBreakdown && subscriptionBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={subscriptionBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="status"
                  >
                    {subscriptionBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                  />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-400">No subscription data available</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-gray-500" />
            Recent Activity
          </h3>
        </div>
        <div className="divide-y divide-gray-100">
          {loadingActivity ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 flex gap-4">
                <Skeleton className="w-2 h-2 rounded-full mt-2" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-1/4" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))
          ) : recentActivity && recentActivity.length > 0 ? (
            recentActivity.map((activity) => (
              <div key={activity.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <div>
                  <p className="text-sm text-gray-900 font-medium">
                    {activity.type.charAt(0).toUpperCase() + activity.type.slice(1).replace("_", " ")}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">{activity.description}</p>
                  <p className="text-xs text-gray-400 mt-1">{formatDate(activity.timestamp, "MMM d, yyyy h:mm a")}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-gray-500">No recent activity</div>
          )}
        </div>
      </div>
    </div>
  );
}
