import { useParams, Link } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { useMacVendor } from "@/hooks/useMacVendor";
import { useCurrency } from "@/hooks/useCurrency";
import {
  useGetCustomer,
  useListSubscriptions,
  useListInvoices,
  useListTickets,
  useGetCustomerSessions,
  useGetCustomerUsageSnapshots,
  useSaveUsageSnapshot,
  useGetCustomerRadiusSessions,
  useListCustomerVpnConfigs,
  useIssueCustomerVpnConfig,
  useRevokeCustomerVpnConfig,
  type CustomerSession,
} from "@workspace/api-client-react";
import {
  User, Mail, Phone, MapPin, Calendar, CreditCard, Receipt,
  LifeBuoy, ArrowLeft, Edit, KeyRound, Wifi, WifiOff, Signal,
  Eye, EyeOff, RefreshCw, Download, Upload, Clock, Cpu,
  MonitorSmartphone, AlertCircle, Router, History, MessageSquare,
  ClipboardList, HardDrive, Send, Trash2, Plus, ArrowDownToLine,
  CheckCircle2, XCircle, ServerCrash, DollarSign, BellRing,
  ShieldCheck, ShieldOff, FileLock2,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { formatDate } from "@/lib/formatDate";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtUptime(secs: number): string {
  if (!secs) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

// ── sub-components ────────────────────────────────────────────────────────────

function UptimeTicker({ startSeconds }: { startSeconds: number }) {
  const [elapsed, setElapsed] = useState(startSeconds);
  useEffect(() => {
    setElapsed(startSeconds);
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [startSeconds]);
  return <span className="font-mono text-sm">{fmtUptime(elapsed)}</span>;
}

function PasswordField({ password }: { password: string | null }) {
  const [show, setShow] = useState(false);
  if (!password) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-gray-700 tracking-widest">
        {show ? password : "•".repeat(Math.min(password.length, 12))}
      </span>
      <button
        onClick={() => setShow(v => !v)}
        className="text-gray-400 hover:text-gray-600 transition-colors"
        title={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}

function MacVendorRow({ mac }: { mac: string }) {
  const { vendor, loading } = useMacVendor(mac);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="font-mono">{mac}</span>
      {loading && <span className="text-gray-300 animate-pulse">detecting…</span>}
      {!loading && vendor && (
        <span className="inline-flex items-center gap-1 bg-blue-50 border border-blue-100 text-blue-700 rounded px-1.5 py-0.5 font-medium">
          {vendor}
        </span>
      )}
      {!loading && !vendor && <span className="text-gray-400">MAC Address</span>}
    </div>
  );
}

type Session = CustomerSession;

interface Snapshot {
  id: number;
  subscriptionId: number;
  bytesIn: number;
  bytesOut: number;
  recordedAt: string;
}

interface SessionCardProps {
  session: Session;
  subPlanName: string;
  snapshots: Snapshot[];
}

function SessionCard({ session, subPlanName, snapshots }: SessionCardProps) {
  const isOnline = session.status === "online";
  const noRouter = session.status === "no_router";

  // Build chart data: throughput in Mbps over each snapshot interval
  const chartData = snapshots.map((s, i) => {
    const prev = snapshots[i - 1];
    if (!prev) return { time: fmtTime(s.recordedAt), download: 0, upload: 0, index: i };
    const secs = Math.max(1, (new Date(s.recordedAt).getTime() - new Date(prev.recordedAt).getTime()) / 1000);
    const toMbps = (bytes: number) => parseFloat((Math.max(0, bytes) * 8 / (secs * 1_000_000)).toFixed(3));
    return {
      time: fmtTime(s.recordedAt),
      download: toMbps(s.bytesIn  - prev.bytesIn),
      upload:   toMbps(s.bytesOut - prev.bytesOut),
      index: i,
    };
  });

  return (
    <div className={`bg-white rounded-xl border-2 shadow-sm overflow-hidden transition-all ${
      isOnline ? "border-green-200" : noRouter ? "border-gray-200" : "border-red-100"
    }`}>
      {/* Card header */}
      <div className={`px-5 py-4 flex items-center justify-between ${
        isOnline ? "bg-green-50" : noRouter ? "bg-gray-50" : "bg-red-50"
      }`}>
        <div className="flex items-center gap-3">
          {isOnline ? (
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
            </span>
          ) : (
            <span className={`flex h-3 w-3 rounded-full ${noRouter ? "bg-gray-300" : "bg-red-400"}`} />
          )}
          <div>
            <p className="font-semibold text-gray-900 text-sm">{subPlanName}</p>
            <p className={`text-xs font-medium capitalize ${
              isOnline ? "text-green-600" : noRouter ? "text-gray-500" : "text-red-500"
            }`}>
              {noRouter ? "No Router Assigned" : isOnline
                ? session.sessionType === "hotspot" ? "Hotspot — Online" : "PPPoE — Online"
                : "Offline"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {session.routerName && (
            <span className="flex items-center gap-1 text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-1">
              <Router className="w-3 h-3" /> {session.routerName}
            </span>
          )}
          {session.sessionType === "hotspot" && (
            <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-1">
              <MonitorSmartphone className="w-3 h-3" /> Hotspot
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Error message */}
        {session.routerError && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{session.routerError}</span>
          </div>
        )}

        {/* Live stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatBox
            icon={<Clock className="w-4 h-4 text-blue-500" />}
            label="Uptime"
            value={isOnline
              ? <UptimeTicker startSeconds={session.uptimeSeconds} />
              : <span className="font-mono text-sm text-gray-400">—</span>}
          />
          <StatBox
            icon={<Signal className="w-4 h-4 text-purple-500" />}
            label="IP Address"
            value={<span className="font-mono text-sm">{session.ipAddress || "—"}</span>}
          />
          <StatBox
            icon={<Download className="w-4 h-4 text-green-500" />}
            label="Downloaded"
            value={<span className="font-mono text-sm">{isOnline ? session.bytesInFormatted : "—"}</span>}
          />
          <StatBox
            icon={<Upload className="w-4 h-4 text-orange-500" />}
            label="Uploaded"
            value={<span className="font-mono text-sm">{isOnline ? session.bytesOutFormatted : "—"}</span>}
          />
        </div>

        {/* Credentials */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <KeyRound className="w-3 h-3" /> Username
            </p>
            <span className="font-mono text-sm text-gray-800 break-all">
              {session.pppoeUsername || "—"}
            </span>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <KeyRound className="w-3 h-3" /> Password
            </p>
            <PasswordField password={session.pppoePassword ?? null} />
          </div>
        </div>

        {/* MAC + vendor */}
        {session.callerMac && (
          <MacVendorRow mac={session.callerMac} />
        )}

        {/* Usage chart */}
        {(() => {
          const hasBytes = chartData.some(d => d.download > 0 || d.upload > 0);
          if (chartData.length >= 2 && hasBytes) {
            return (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                  <Signal className="w-3 h-3" /> Live Throughput (Mbps)
                </p>
                <ResponsiveContainer width="100%" height={140}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`dl-${session.subscriptionId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`ul-${session.subscriptionId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, (dataMax: number) => Math.max(parseFloat((dataMax * 1.3).toFixed(2)), 0.1)]}
                      tickFormatter={(v: number) => v >= 1 ? `${v.toFixed(1)}` : `${v.toFixed(2)}`}
                      width={36}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8 }}
                      formatter={(v: number, name: string) => [`${v} Mbps`, name === "download" ? "↓ Download" : "↑ Upload"]}
                    />
                    <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "download" ? "↓ Download" : "↑ Upload"} />
                    <Area type="monotone" dataKey="download" stroke="#22c55e" strokeWidth={2} fill={`url(#dl-${session.subscriptionId})`} dot={false} />
                    <Area type="monotone" dataKey="upload" stroke="#f97316" strokeWidth={2} fill={`url(#ul-${session.subscriptionId})`} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            );
          }
          if (chartData.length >= 2 && !hasBytes) {
            return (
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Traffic counters are reporting 0 B. Enable <strong>IP → Traffic Flow</strong> or{" "}
                  <strong>PPP → Accounting</strong> on your MikroTik router to see live usage graphs.
                </span>
              </div>
            );
          }
          if (chartData.length === 1) {
            return (
              <p className="text-xs text-gray-400 text-center py-2">
                Collecting data… graph will appear after the next refresh.
              </p>
            );
          }
          return (
            <p className="text-xs text-gray-400 text-center py-2">
              No usage history yet. Data is recorded each time this page refreshes.
            </p>
          );
        })()}
      </div>
    </div>
  );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-gray-900">{value}</div>
    </div>
  );
}

// ── Billing Activity Chart ────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  paid:     "#22c55e",
  sent:     "#3b82f6",
  overdue:  "#ef4444",
  draft:    "#d1d5db",
  void:     "#9ca3af",
};

function BillingActivityChart({ invoices }: { invoices: any[] }) {
  const { fmtMoney } = useCurrency();
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
        <Receipt className="w-10 h-10 mb-3 text-gray-200" />
        <p className="text-sm font-medium">No invoices yet</p>
        <p className="text-xs mt-1">Invoices will appear here once generated.</p>
      </div>
    );
  }

  const sorted = [...invoices].sort(
    (a, b) => new Date(a.dueDate ?? a.due_date ?? a.createdAt ?? a.created_at).getTime()
           - new Date(b.dueDate ?? b.due_date ?? b.createdAt ?? b.created_at).getTime()
  );

  const chartData = sorted.map((inv: any) => {
    const dateStr = inv.dueDate ?? inv.due_date ?? inv.createdAt ?? inv.created_at ?? "";
    const label = dateStr
      ? new Date(dateStr).toLocaleDateString("en-KE", { month: "short", year: "2-digit" })
      : `#${inv.id}`;
    return {
      label,
      amount: Number(inv.amount ?? 0),
      status: inv.status ?? "draft",
    };
  });

  const totalBilled = chartData.reduce((s, r) => s + r.amount, 0);
  const totalPaid   = chartData.filter(r => r.status === "paid").reduce((s, r) => s + r.amount, 0);
  const outstanding = totalBilled - totalPaid;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Billed",  value: fmtMoney(totalBilled, 0),   color: "text-gray-900" },
          { label: "Total Paid",    value: fmtMoney(totalPaid, 0),      color: "text-green-600" },
          { label: "Outstanding",   value: fmtMoney(outstanding, 0),    color: outstanding > 0 ? "text-red-500" : "text-gray-400" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-center">
            <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
            <p className={`text-base font-bold ${kpi.color}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
            formatter={(v: number, _: string, entry: any) => [
              fmtMoney(v, 0),
              entry.payload.status.charAt(0).toUpperCase() + entry.payload.status.slice(1),
            ]}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={48}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={STATUS_COLOR[entry.status] ?? "#d1d5db"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 justify-center">
        {Object.entries(STATUS_COLOR).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1.5 text-xs text-gray-500 capitalize">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
            {status}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function CustomerDetail() {
  const { fmtMoney } = useCurrency();
  const { id } = useParams();
  const customerId = parseInt(id || "0", 10);
  const { canManageCustomers, canManageBilling, canManageTickets, isAdmin } = useCurrentUser();

  const { data: customer, isLoading: loadingCustomer } = useGetCustomer(customerId);
  const { data: subscriptionsData, isLoading: loadingSubs } = useListSubscriptions({ customerId });
  const { data: invoicesData, isLoading: loadingInvoices } = useListInvoices({ customerId, limit: 10 });
  const { data: ticketsData, isLoading: loadingTickets } = useListTickets({ customerId });

  const {
    data: sessions,
    isLoading: loadingSessions,
    refetch: refetchSessions,
    dataUpdatedAt,
  } = useGetCustomerSessions(customerId);

  const { data: snapshotMap, refetch: refetchSnapshots } = useGetCustomerUsageSnapshots(customerId);

  const { data: radiusSessions, isLoading: loadingRadius, refetch: refetchRadius } = useGetCustomerRadiusSessions(customerId);

  const { data: vpnConfigs, isLoading: loadingVpn, refetch: refetchVpn } = useListCustomerVpnConfigs(customerId);
  const issueMutation   = useIssueCustomerVpnConfig();
  const revokeMutation  = useRevokeCustomerVpnConfig();
  const [vpnIssuing,   setVpnIssuing]   = useState(false);
  const [vpnRevoking,  setVpnRevoking]  = useState<number | null>(null);
  const [vpnError,     setVpnError]     = useState<string | null>(null);
  const vpnAvailable = vpnConfigs?.vpnAvailable ?? true;

  const handleIssueVpn = async () => {
    setVpnIssuing(true);
    setVpnError(null);
    try {
      const result = await issueMutation.mutateAsync({ id: customerId });
      if (result.ovpnConfig) {
        const blob = new Blob([result.ovpnConfig], { type: "application/x-openvpn-profile" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `${result.commonName}.ovpn`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      refetchVpn();
    } catch (e: any) {
      setVpnError(e?.message ?? "Failed to issue VPN config");
    } finally {
      setVpnIssuing(false);
    }
  };

  const handleRevokeVpn = async (configId: number) => {
    setVpnRevoking(configId);
    setVpnError(null);
    try {
      await revokeMutation.mutateAsync({ id: customerId, configId });
      refetchVpn();
    } catch (e: any) {
      setVpnError(e?.message ?? "Failed to revoke VPN config");
    } finally {
      setVpnRevoking(null);
    }
  };

  const saveSnapshot = useSaveUsageSnapshot();
  const lastSavedAt = useRef(0);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => { refetchSessions(); }, 30_000);
    return () => clearInterval(id);
  }, [refetchSessions]);

  // After each live session fetch, persist a snapshot for graphing AND log session for compliance
  useEffect(() => {
    if (!sessions || !Array.isArray(sessions)) return;
    // Debounce — only save once per refetch cycle
    if (Date.now() - lastSavedAt.current < 20_000) return;
    lastSavedAt.current = Date.now();

    const onlineSessions = sessions.filter((s: Session) => s.status === "online");

    // Snapshot save (for graph)
    if (onlineSessions.length > 0) {
      saveSnapshot.mutate(
        {
          id: customerId,
          data: {
            snapshots: onlineSessions.map((s: Session) => ({
              subscriptionId: s.subscriptionId,
              bytesIn: s.bytesIn,
              bytesOut: s.bytesOut,
            })),
          },
        },
        { onSuccess: () => refetchSnapshots() }
      );
    }

    // Compliance session log — fire-and-forget for ALL sessions
    const allSessionsPayload = (sessions as Session[]).map((s: Session) => ({
      subscriptionId: s.subscriptionId,
      pppoeUsername:  s.pppoeUsername ?? null,
      ipAddress:      s.ipAddress ?? null,
      macAddress:     s.callerMac ?? null,
      sessionType:    s.sessionType ?? "pppoe",
      routerName:     s.routerName ?? null,
      bytesIn:        s.bytesIn,
      bytesOut:       s.bytesOut,
      online:         s.status === "online",
    }));

    fetch(`/api/customers/${customerId}/sessions/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessions: allSessionsPayload }),
    }).catch(() => { /* non-critical */ });
  }, [dataUpdatedAt]);

  const handleRefresh = useCallback(() => {
    lastSavedAt.current = 0;
    refetchSessions();
  }, [refetchSessions]);

  // ── New tab data ───────────────────────────────────────────────────────────

  // Usage history (session logs)
  const [sessionLogs, setSessionLogs]       = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs]       = useState(false);
  const [logFrom, setLogFrom]               = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [logTo, setLogTo]                   = useState(() => new Date().toISOString().slice(0, 10));
  const [activeTab, setActiveTab]           = useState("overview");

  const fetchSessionLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const r = await fetch(`/api/customers/${customerId}/session-logs?from=${logFrom}&to=${logTo}&limit=100`);
      if (r.ok) setSessionLogs(await r.json());
    } finally { setLoadingLogs(false); }
  }, [customerId, logFrom, logTo]);

  useEffect(() => { if (activeTab === "usage") fetchSessionLogs(); }, [activeTab, fetchSessionLogs]);

  // Communications
  const [comms, setComms]                   = useState<any[]>([]);
  const [loadingComms, setLoadingComms]     = useState(false);
  const [newComm, setNewComm]               = useState({ type: "note", direction: "outbound", subject: "", content: "" });
  const [sendingComm, setSendingComm]       = useState(false);

  const fetchComms = useCallback(async () => {
    setLoadingComms(true);
    try {
      const r = await fetch(`/api/customers/${customerId}/communications`);
      if (r.ok) setComms(await r.json());
    } finally { setLoadingComms(false); }
  }, [customerId]);

  useEffect(() => { if (activeTab === "communication") fetchComms(); }, [activeTab, fetchComms]);

  const submitComm = async () => {
    if (!newComm.content.trim()) return;
    setSendingComm(true);
    try {
      const r = await fetch(`/api/customers/${customerId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newComm),
      });
      if (r.ok) {
        setNewComm({ type: "note", direction: "outbound", subject: "", content: "" });
        fetchComms();
      }
    } finally { setSendingComm(false); }
  };

  const deleteComm = async (commId: number) => {
    await fetch(`/api/customers/${customerId}/communications/${commId}`, { method: "DELETE" });
    setComms(c => c.filter(x => x.id !== commId));
  };

  // Technician reminder
  const [reminderOpen, setReminderOpen]     = useState(false);
  const [reminderPhone, setReminderPhone]   = useState("");
  const [reminderMsg, setReminderMsg]       = useState("");
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderResult, setReminderResult] = useState<{ ok: boolean; text: string } | null>(null);

  function openReminder() {
    const sub = subs[0] as any;
    const planName = sub?.plan?.name ?? "their service plan";
    setReminderMsg(
      `Hi, please check on customer ${customer?.name ?? ""} (${customer?.phone ?? ""}) who is experiencing intermittent service on ${planName}. Kindly investigate and resolve ASAP.`,
    );
    setReminderPhone("");
    setReminderResult(null);
    setReminderOpen(true);
  }

  async function sendReminder() {
    if (!reminderPhone || !reminderMsg) return;
    setReminderSending(true);
    setReminderResult(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/remind-technician`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: reminderPhone, message: reminderMsg }),
        credentials: "include",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      setReminderResult({ ok: !!data.success, text: data.success ? "Reminder sent successfully." : (data.error ?? "Failed to send.") });
      if (data.success) setTimeout(() => setReminderOpen(false), 1500);
    } catch {
      setReminderResult({ ok: false, text: "Network error." });
    } finally {
      setReminderSending(false);
    }
  }

  // Equipment
  const [equipment, setEquipment]           = useState<any[]>([]);
  const [loadingEquip, setLoadingEquip]     = useState(false);

  useEffect(() => {
    if (activeTab !== "equipment") return;
    setLoadingEquip(true);
    fetch(`/api/customers/${customerId}/equipment`)
      .then(r => r.json()).then(setEquipment).catch(() => {})
      .finally(() => setLoadingEquip(false));
  }, [activeTab, customerId]);

  // Payments (for audit log)
  const [payments, setPayments]             = useState<any[]>([]);
  useEffect(() => {
    if (activeTab !== "audit") return;
    fetch(`/api/customers/${customerId}/payments`)
      .then(r => r.json()).then(setPayments).catch(() => {});
  }, [activeTab, customerId]);

  const subs = Array.isArray(subscriptionsData) ? subscriptionsData : [];
  const tickets = Array.isArray(ticketsData) ? ticketsData : [];
  const invoices = (invoicesData as any)?.data ?? invoicesData ?? [];
  const sessionList: Session[] = Array.isArray(sessions) ? sessions : [];

  // Map subscriptionId → plan name from subs list
  const subPlanMap = new Map<number, string>(
    subs.map((s: any) => [s.id, s.plan?.name ?? `Plan #${s.planId}`])
  );

  const onlineCount = sessionList.filter(s => s.status === "online").length;

  if (loadingCustomer) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-[400px] rounded-xl" />
          <div className="lg:col-span-2"><Skeleton className="h-[400px] rounded-xl" /></div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900">Customer not found</h2>
        <p className="text-gray-500 mt-2">The customer you're looking for doesn't exist.</p>
        <Button asChild className="mt-4"><Link href="/customers">Back to Customers</Link></Button>
      </div>
    );
  }

  const statusColor = (s: string) => {
    switch (s) {
      case "active": return "bg-green-100 text-green-700 border-green-200";
      case "suspended": return "bg-orange-100 text-orange-700 border-orange-200";
      case "terminated": return "bg-red-100 text-red-700 border-red-200";
      default: return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild className="h-8 w-8">
          <Link href="/customers"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{customer.name}</h1>
            <Badge variant="outline" className={`capitalize ${statusColor(customer.status)}`}>{customer.status}</Badge>
          </div>
          <p className="text-gray-500 text-sm">Customer ID: #{customer.id}</p>
        </div>
        <Button variant="outline" size="sm" onClick={openReminder} className="gap-2 text-amber-700 border-amber-300 hover:bg-amber-50">
          <BellRing className="w-4 h-4" /> Remind Technician
        </Button>
        {canManageCustomers && (
          <Button variant="outline" className="bg-white">
            <Edit className="w-4 h-4 mr-2" /> Edit Profile
          </Button>
        )}
      </div>

      {/* Technician reminder dialog */}
      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="w-5 h-5 text-amber-500" />
              Remind Technician — {customer?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-500">
              Send an SMS reminder to a technician to investigate this customer's intermittent service.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="tech-phone" className="text-sm font-medium">Technician Phone Number</Label>
              <Input
                id="tech-phone"
                placeholder="e.g. 0712345678"
                value={reminderPhone}
                onChange={(e) => setReminderPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tech-msg" className="text-sm font-medium">Message</Label>
              <Textarea
                id="tech-msg"
                rows={4}
                value={reminderMsg}
                onChange={(e) => setReminderMsg(e.target.value)}
                className="text-sm resize-none"
              />
            </div>
            {reminderResult && (
              <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 border ${
                reminderResult.ok
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}>
                {reminderResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                {reminderResult.text}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setReminderOpen(false)} disabled={reminderSending}>Cancel</Button>
            <Button
              size="sm"
              onClick={sendReminder}
              disabled={reminderSending || !reminderPhone || !reminderMsg}
              className="gap-2 bg-amber-600 hover:bg-amber-700"
            >
              {reminderSending
                ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending…</>
                : <><Send className="w-3.5 h-3.5" />Send Reminder</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center">
              <User className="w-4 h-4 mr-2 text-gray-500" /> Contact Information
            </h3>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Email Address</p>
                  <a href={`mailto:${customer.email}`} className="text-sm text-blue-600 hover:underline">{customer.email}</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Phone Number</p>
                  <a href={`tel:${customer.phone}`} className="text-sm text-blue-600 hover:underline">{customer.phone}</a>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Billing Address</p>
                  <p className="text-sm text-gray-600">{customer.address}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Calendar className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Customer Since</p>
                  <p className="text-sm text-gray-600">{formatDate(customer.createdAt, "MMMM d, yyyy")}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Live session summary */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <Wifi className="w-4 h-4 text-blue-500" /> Connection Status
              </h3>
              <button
                onClick={handleRefresh}
                className="text-gray-400 hover:text-blue-500 transition-colors"
                title="Refresh now"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSessions ? "animate-spin" : ""}`} />
              </button>
            </div>
            {loadingSessions ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : sessionList.length === 0 ? (
              <p className="text-sm text-gray-400">No subscriptions with routers assigned.</p>
            ) : (
              <div className="space-y-2">
                {sessionList.map(s => (
                  <div key={s.subscriptionId} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      {s.status === "online"
                        ? <Wifi className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                        : <WifiOff className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                      <span className="text-xs text-gray-600 truncate font-mono">{s.pppoeUsername || "—"}</span>
                    </div>
                    <span className={`text-xs font-medium ${s.status === "online" ? "text-green-600" : "text-red-400"}`}>
                      {s.status === "online" ? "Online" : s.status === "no_router" ? "No Router" : "Offline"}
                    </span>
                  </div>
                ))}
                <p className="text-xs text-gray-400 pt-2 border-t mt-2">
                  Auto-refreshes every 30s · {onlineCount}/{sessionList.length} online
                </p>
              </div>
            )}
          </div>

          {customer.notes && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
              <h3 className="font-semibold text-gray-900 mb-2 text-sm">Staff Notes</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview" className="w-full" onValueChange={setActiveTab}>
            <TabsList className="bg-gray-100 p-1 w-full justify-start rounded-lg mb-6 flex-wrap h-auto gap-1">
              <TabsTrigger value="overview" className="data-[state=active]:bg-white rounded-md">
                <Receipt className="w-4 h-4 mr-2" /> Overview
              </TabsTrigger>
              <TabsTrigger value="sessions" className="data-[state=active]:bg-white rounded-md">
                <Wifi className="w-4 h-4 mr-2" />
                Live Sessions
                {onlineCount > 0 && (
                  <span className="ml-1.5 bg-green-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                    {onlineCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="subscriptions" className="data-[state=active]:bg-white rounded-md">
                <CreditCard className="w-4 h-4 mr-2" /> Subscriptions ({subs.length})
              </TabsTrigger>
              <TabsTrigger value="invoices" className="data-[state=active]:bg-white rounded-md">
                <Receipt className="w-4 h-4 mr-2" /> Invoices ({Array.isArray(invoices) ? invoices.length : 0})
              </TabsTrigger>
              <TabsTrigger value="tickets" className="data-[state=active]:bg-white rounded-md">
                <LifeBuoy className="w-4 h-4 mr-2" /> Tickets ({tickets.length})
              </TabsTrigger>
              <TabsTrigger value="usage" className="data-[state=active]:bg-white rounded-md">
                <History className="w-4 h-4 mr-2" /> Usage History
              </TabsTrigger>
              <TabsTrigger value="communication" className="data-[state=active]:bg-white rounded-md">
                <MessageSquare className="w-4 h-4 mr-2" /> Communication
              </TabsTrigger>
              <TabsTrigger value="audit" className="data-[state=active]:bg-white rounded-md">
                <ClipboardList className="w-4 h-4 mr-2" /> Audit Log
              </TabsTrigger>
              <TabsTrigger value="equipment" className="data-[state=active]:bg-white rounded-md">
                <HardDrive className="w-4 h-4 mr-2" /> Equipment
              </TabsTrigger>
              <TabsTrigger value="radius" className="data-[state=active]:bg-white rounded-md">
                <Signal className="w-4 h-4 mr-2" /> RADIUS
              </TabsTrigger>
              <TabsTrigger value="vpn" className="data-[state=active]:bg-white rounded-md">
                <ShieldCheck className="w-4 h-4 mr-2" /> VPN
              </TabsTrigger>
            </TabsList>

            {/* ── Overview tab ── */}
            <TabsContent value="overview" className="m-0">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <h3 className="font-semibold text-gray-900 mb-5 flex items-center gap-2 text-sm">
                  <Receipt className="w-4 h-4 text-blue-500" /> Billing Activity
                </h3>
                {loadingInvoices
                  ? <Skeleton className="h-52 w-full rounded-lg" />
                  : <BillingActivityChart invoices={Array.isArray(invoices) ? invoices : []} />
                }
              </div>
            </TabsContent>

            {/* ── Live Sessions tab ── */}
            <TabsContent value="sessions" className="m-0">
              <div className="space-y-4">
                {loadingSessions ? (
                  <div className="space-y-4">
                    <Skeleton className="h-64 rounded-xl" />
                    <Skeleton className="h-64 rounded-xl" />
                  </div>
                ) : sessionList.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <WifiOff className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="font-medium text-gray-600">No router-linked subscriptions</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Assign a router to a subscription to see live session data.
                    </p>
                  </div>
                ) : (
                  sessionList.map(session => {
                    const snapshots: Snapshot[] = (snapshotMap as any)?.[session.subscriptionId] ?? [];
                    return (
                      <SessionCard
                        key={session.subscriptionId}
                        session={session}
                        subPlanName={subPlanMap.get(session.subscriptionId) ?? `Subscription #${session.subscriptionId}`}
                        snapshots={snapshots}
                      />
                    );
                  })
                )}
              </div>
            </TabsContent>

            {/* ── Subscriptions tab ── */}
            <TabsContent value="subscriptions" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {canManageBilling && (
                  <div className="px-5 py-3 border-b border-gray-100 flex justify-end">
                    <Button size="sm" asChild className="gap-1.5">
                      <Link href={`/subscriptions?customerId=${customerId}`}>
                        <Plus className="w-3.5 h-3.5" /> Add Subscription
                      </Link>
                    </Button>
                  </div>
                )}
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>PPPoE Username</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Start Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSubs ? (
                      <TableRow><TableCell colSpan={5}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : subs.length > 0 ? (
                      subs.map((sub: any) => (
                        <TableRow key={sub.id}>
                          <TableCell className="font-medium text-gray-900">{sub.plan?.name || `Plan #${sub.planId}`}</TableCell>
                          <TableCell>
                            {sub.pppoeUsername ? (
                              <span className="flex items-center gap-1 font-mono text-xs text-gray-700">
                                <KeyRound className="w-3 h-3 text-blue-400 flex-shrink-0" />
                                {sub.pppoeUsername}
                              </span>
                            ) : <span className="text-gray-400 text-xs">—</span>}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-gray-600">{sub.ipAddress || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${sub.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100"}`}>
                              {sub.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">{formatDate(sub.startDate)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={5} className="h-24 text-center text-gray-500">No subscriptions found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ── Invoices tab ── */}
            <TabsContent value="invoices" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {canManageBilling && (
                  <div className="px-5 py-3 border-b border-gray-100 flex justify-end">
                    <Button size="sm" asChild className="gap-1.5">
                      <Link href={`/invoices?customerId=${customerId}`}>
                        <Plus className="w-3.5 h-3.5" /> Add Invoice
                      </Link>
                    </Button>
                  </div>
                )}
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Invoice ID</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Due Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingInvoices ? (
                      <TableRow><TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : Array.isArray(invoices) && invoices.length > 0 ? (
                      invoices.map((invoice: any) => (
                        <TableRow key={invoice.id}>
                          <TableCell className="font-mono text-sm text-gray-600">INV-{String(invoice.id).padStart(5, "0")}</TableCell>
                          <TableCell className="font-medium text-gray-900">{fmtMoney(invoice.total ?? invoice.amount)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize ${invoice.status === "paid" ? "bg-green-100 text-green-700" : invoice.status === "overdue" ? "bg-red-100 text-red-700" : "bg-gray-100"}`}>
                              {invoice.status}
                            </Badge>
                          </TableCell>
                          <TableCell className={`text-sm ${invoice.status === "overdue" ? "text-red-600 font-medium" : "text-gray-600"}`}>
                            {formatDate(invoice.dueDate)}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={4} className="h-24 text-center text-gray-500">No invoices found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ── Tickets tab ── */}
            <TabsContent value="tickets" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                {canManageTickets && (
                  <div className="px-5 py-3 border-b border-gray-100 flex justify-end">
                    <Button size="sm" asChild className="gap-1.5">
                      <Link href={`/tickets?customerId=${customerId}`}>
                        <Plus className="w-3.5 h-3.5" /> New Ticket
                      </Link>
                    </Button>
                  </div>
                )}
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingTickets ? (
                      <TableRow><TableCell colSpan={4}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : tickets.length > 0 ? (
                      tickets.map((ticket: any) => (
                        <TableRow key={ticket.id} className="cursor-pointer hover:bg-gray-50">
                          <TableCell className="font-mono text-sm text-gray-500">
                            <Link href={`/tickets/${ticket.id}`}>#{ticket.id}</Link>
                          </TableCell>
                          <TableCell className="font-medium text-gray-900">
                            <Link href={`/tickets/${ticket.id}`} className="hover:text-blue-600">{ticket.subject}</Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="bg-gray-100 capitalize">{ticket.status.replace("_", " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-600">{formatDate(ticket.createdAt)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={4} className="h-24 text-center text-gray-500">No support tickets found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ── Usage History tab ── */}
            <TabsContent value="usage" className="m-0 space-y-4">
              {/* Date filters */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                  <input type="date" value={logFrom} onChange={e => setLogFrom(e.target.value)}
                    className="border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                  <input type="date" value={logTo} onChange={e => setLogTo(e.target.value)}
                    className="border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <Button size="sm" onClick={fetchSessionLogs} disabled={loadingLogs} className="bg-blue-600 hover:bg-blue-700">
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingLogs ? "animate-spin" : ""}`} /> Apply
                </Button>
                <span className="text-xs text-gray-400 ml-auto">{sessionLogs.length} sessions found</span>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-left text-[11px] text-gray-500 uppercase">
                        <th className="px-4 py-3 font-medium">Session Start</th>
                        <th className="px-4 py-3 font-medium">Session End</th>
                        <th className="px-4 py-3 font-medium">Duration</th>
                        <th className="px-4 py-3 font-medium">Device IP</th>
                        <th className="px-4 py-3 font-medium">MAC</th>
                        <th className="px-4 py-3 font-medium">Router</th>
                        <th className="px-4 py-3 font-medium">Type</th>
                        <th className="px-4 py-3 font-medium">↓ Download</th>
                        <th className="px-4 py-3 font-medium">↑ Upload</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingLogs ? (
                        [0,1,2,3,4].map(i => (
                          <tr key={i} className="border-b border-gray-50">
                            {[0,1,2,3,4,5,6,7,8].map(j => (
                              <td key={j} className="px-4 py-3"><div className="h-3 bg-gray-100 rounded animate-pulse" /></td>
                            ))}
                          </tr>
                        ))
                      ) : sessionLogs.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-4 py-12 text-center text-gray-400">
                            <History className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                            No session history in this date range.
                          </td>
                        </tr>
                      ) : sessionLogs.map((s: any, i: number) => {
                        const start = new Date(s.sessionStart);
                        const end   = s.sessionEnd ? new Date(s.sessionEnd) : null;
                        const durSecs = end ? Math.floor((end.getTime() - start.getTime()) / 1000) : null;
                        const dur = durSecs === null ? "Active" : durSecs < 60 ? `${durSecs}s` : durSecs < 3600 ? `${Math.floor(durSecs/60)}m ${durSecs%60}s` : `${Math.floor(durSecs/3600)}h ${Math.floor((durSecs%3600)/60)}m`;
                        const fmtB = (n: number) => n >= 1e9 ? `${(n/1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n/1e6).toFixed(2)} MB` : n >= 1e3 ? `${(n/1e3).toFixed(1)} KB` : `${n} B`;
                        return (
                          <tr key={s.id} className={`border-b border-gray-50 ${i%2===0?"bg-white":"bg-gray-50/30"}`}>
                            <td className="px-4 py-2.5 font-mono whitespace-nowrap">{start.toLocaleString("en-KE",{dateStyle:"short",timeStyle:"short"})}</td>
                            <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                              {end ? end.toLocaleString("en-KE",{dateStyle:"short",timeStyle:"short"}) : <span className="text-green-600 font-medium">Active</span>}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">{dur}</td>
                            <td className="px-4 py-2.5 font-mono">{s.ipAddress ?? "—"}</td>
                            <td className="px-4 py-2.5 font-mono text-[10px]">{s.macAddress ?? "—"}</td>
                            <td className="px-4 py-2.5">{s.routerName ?? "—"}</td>
                            <td className="px-4 py-2.5 capitalize">{s.sessionType}</td>
                            <td className="px-4 py-2.5 text-green-700 font-medium">{fmtB(s.bytesIn ?? 0)}</td>
                            <td className="px-4 py-2.5 text-orange-600 font-medium">{fmtB(s.bytesOut ?? 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            {/* ── Communication tab ── */}
            <TabsContent value="communication" className="m-0 space-y-4">
              {/* Add new communication */}
              {canManageCustomers && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="font-semibold text-gray-900 text-sm mb-4 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-blue-500" /> Add Note / Log Communication
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                    <select
                      value={newComm.type}
                      onChange={e => setNewComm(c => ({ ...c, type: e.target.value }))}
                      className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="note">Staff Note</option>
                      <option value="sms">SMS</option>
                      <option value="email">Email</option>
                      <option value="call">Phone Call</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Direction</label>
                    <select
                      value={newComm.direction}
                      onChange={e => setNewComm(c => ({ ...c, direction: e.target.value }))}
                      className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="outbound">Outbound (to customer)</option>
                      <option value="inbound">Inbound (from customer)</option>
                    </select>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Subject (optional)</label>
                  <input
                    type="text"
                    value={newComm.subject}
                    onChange={e => setNewComm(c => ({ ...c, subject: e.target.value }))}
                    placeholder="e.g. Renewal reminder, Complaint call..."
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Content</label>
                  <textarea
                    rows={3}
                    value={newComm.content}
                    onChange={e => setNewComm(c => ({ ...c, content: e.target.value }))}
                    placeholder="Write your note or log what was communicated..."
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                </div>
                <Button onClick={submitComm} disabled={sendingComm || !newComm.content.trim()} className="bg-blue-600 hover:bg-blue-700 gap-2">
                  <Send className="w-3.5 h-3.5" /> {sendingComm ? "Saving…" : "Save"}
                </Button>
              </div>
              )}

              {/* Communication list */}
              <div className="space-y-3">
                {loadingComms ? (
                  [0,1,2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)
                ) : comms.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
                    <MessageSquare className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">No communications logged yet.</p>
                  </div>
                ) : comms.map((c: any) => {
                  const typeIcon: Record<string, React.ReactNode> = {
                    note: <ClipboardList className="w-3.5 h-3.5" />,
                    sms: <MessageSquare className="w-3.5 h-3.5" />,
                    email: <Mail className="w-3.5 h-3.5" />,
                    call: <Phone className="w-3.5 h-3.5" />,
                  };
                  const typeColor: Record<string, string> = {
                    note: "bg-gray-100 text-gray-600",
                    sms: "bg-blue-50 text-blue-600",
                    email: "bg-purple-50 text-purple-600",
                    call: "bg-green-50 text-green-600",
                  };
                  return (
                    <div key={c.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${typeColor[c.type] ?? "bg-gray-100 text-gray-600"}`}>
                            {typeIcon[c.type]} {c.type}
                          </span>
                          <Badge variant="outline" className={`text-[10px] capitalize ${c.direction === "inbound" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                            {c.direction}
                          </Badge>
                          {c.subject && <span className="text-xs font-medium text-gray-700">{c.subject}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-gray-400">
                            {new Date(c.createdAt).toLocaleString("en-KE",{dateStyle:"short",timeStyle:"short"})}
                          </span>
                          {isAdmin && (
                            <button onClick={() => deleteComm(c.id)} className="text-gray-300 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{c.content}</p>
                      {c.sentBy && <p className="text-[11px] text-gray-400 mt-1">— {c.sentBy}</p>}
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {/* ── Audit Log tab ── */}
            <TabsContent value="audit" className="m-0">
              {(() => {
                // Build audit timeline from all loaded data
                const events: Array<{ date: string; icon: React.ReactNode; color: string; title: string; detail?: string }> = [];
                const auditHref = `/audit-logs?entityType=customer&entityId=${customerId}`;

                // Account created
                if ((customer as any)?.createdAt) {
                  events.push({ date: (customer as any).createdAt, icon: <User className="w-3.5 h-3.5" />, color: "bg-blue-100 text-blue-600", title: "Account created", detail: `Status: ${(customer as any).status}` });
                }
                // Subscriptions
                for (const s of subs as any[]) {
                  events.push({ date: s.startDate ?? s.createdAt, icon: <Wifi className="w-3.5 h-3.5" />, color: "bg-green-100 text-green-600", title: `Subscription started`, detail: s.plan?.name ?? `Plan #${s.planId}` });
                  if (s.endDate) events.push({ date: s.endDate, icon: <WifiOff className="w-3.5 h-3.5" />, color: "bg-red-100 text-red-600", title: "Subscription ended", detail: s.plan?.name });
                }
                // Invoices
                for (const inv of (Array.isArray(invoices) ? invoices : []) as any[]) {
                  events.push({ date: inv.createdAt, icon: <Receipt className="w-3.5 h-3.5" />, color: "bg-gray-100 text-gray-600", title: `Invoice generated`, detail: `INV-${String(inv.id).padStart(5,"0")} · ${fmtMoney(inv.total ?? inv.amount)}` });
                  if (inv.paidAt) events.push({ date: inv.paidAt, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "bg-emerald-100 text-emerald-600", title: "Invoice paid", detail: `INV-${String(inv.id).padStart(5,"0")}` });
                  if (inv.status === "overdue") events.push({ date: inv.dueDate, icon: <XCircle className="w-3.5 h-3.5" />, color: "bg-red-100 text-red-600", title: "Invoice overdue", detail: `INV-${String(inv.id).padStart(5,"0")}` });
                }
                // Payments
                for (const p of payments as any[]) {
                  events.push({ date: p.createdAt, icon: <DollarSign className="w-3.5 h-3.5" />, color: "bg-emerald-100 text-emerald-600", title: `Payment received`, detail: `${fmtMoney(p.amount)} via ${p.method}${p.reference ? ` · ${p.reference}` : ""}` });
                }
                // Tickets
                for (const t of tickets as any[]) {
                  events.push({ date: t.createdAt, icon: <LifeBuoy className="w-3.5 h-3.5" />, color: "bg-orange-100 text-orange-600", title: "Support ticket opened", detail: t.subject });
                  if (t.status === "closed") events.push({ date: t.updatedAt ?? t.createdAt, icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "bg-gray-100 text-gray-500", title: "Ticket closed", detail: t.subject });
                }

                events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                return (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <ClipboardList className="w-4 h-4 text-blue-500" /> Activity Timeline
                      </h3>
                      <Link
                        href={auditHref}
                        className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium"
                      >
                        View full audit history →
                      </Link>
                    </div>
                    {events.length === 0 ? (
                      <div className="p-10 text-center">
                        <ClipboardList className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">No activity recorded yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {events.map((ev, i) => (
                          <div key={i} className="flex items-start gap-4 px-5 py-3.5">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${ev.color}`}>
                              {ev.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900">{ev.title}</p>
                              {ev.detail && <p className="text-xs text-gray-500 truncate">{ev.detail}</p>}
                            </div>
                            <span className="text-[11px] text-gray-400 whitespace-nowrap shrink-0">
                              {new Date(ev.date).toLocaleString("en-KE",{dateStyle:"short",timeStyle:"short"})}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </TabsContent>

            {/* ── Equipment tab ── */}
            <TabsContent value="equipment" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-blue-500" /> Company Equipment at Premises
                  </h3>
                  <span className="text-xs text-gray-400">{equipment.length} device{equipment.length !== 1 ? "s" : ""}</span>
                </div>
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Device</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>IP Address</TableHead>
                      <TableHead>MAC</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingEquip ? (
                      <TableRow><TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : equipment.length > 0 ? (
                      equipment.map((eq: any) => (
                        <TableRow key={eq.id}>
                          <TableCell className="font-medium text-gray-900">{eq.name}</TableCell>
                          <TableCell className="text-sm text-gray-600">{eq.brand ? `${eq.brand} ${eq.model}` : eq.model}</TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1 text-xs">
                              <ServerCrash className="w-3 h-3 text-gray-400" /> {eq.type}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-gray-600">{eq.ipAddress}</TableCell>
                          <TableCell className="font-mono text-xs text-gray-500">{eq.macAddress ?? "—"}</TableCell>
                          <TableCell className="text-sm text-gray-600">{eq.location ?? "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`capitalize text-xs ${eq.status === "online" ? "bg-green-50 text-green-700 border-green-200" : eq.status === "offline" ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-100"}`}>
                              {eq.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center">
                          <HardDrive className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                          <p className="text-sm text-gray-400">No equipment assigned to this customer.</p>
                          <p className="text-xs text-gray-400 mt-1">Go to Network → Equipment and assign a device to this customer.</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ── RADIUS Sessions tab ── */}
            <TabsContent value="radius" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    <Signal className="w-4 h-4 text-blue-500" /> RADIUS Accounting Sessions
                  </h3>
                  <button
                    onClick={() => refetchRadius()}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                </div>
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Session ID</TableHead>
                      <TableHead>NAS IP</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Downloaded</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead>Terminate Cause</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingRadius ? (
                      <TableRow><TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : radiusSessions && radiusSessions.length > 0 ? (
                      radiusSessions.map((s, i) => {
                        const durationSecs = s.sessionTimeSecs ?? 0;
                        const hrs = Math.floor(durationSecs / 3600);
                        const mins = Math.floor((durationSecs % 3600) / 60);
                        const dlMB = ((s.bytesIn ?? 0) / 1_048_576).toFixed(1);
                        const ulMB = ((s.bytesOut ?? 0) / 1_048_576).toFixed(1);
                        return (
                          <TableRow key={s.id ?? i}>
                            <TableCell className="font-mono text-xs text-gray-600 max-w-[140px] truncate">{s.sessionId}</TableCell>
                            <TableCell className="font-mono text-xs text-gray-600">{s.nasIp}</TableCell>
                            <TableCell className="text-xs text-gray-600">
                              {s.startTime ? new Date(s.startTime).toLocaleString() : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-gray-600">
                              {durationSecs > 0 ? `${hrs}h ${mins}m` : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-gray-600">
                              <span className="flex items-center gap-1"><Download className="w-3 h-3 text-blue-400" />{dlMB} MB</span>
                            </TableCell>
                            <TableCell className="text-xs text-gray-600">
                              <span className="flex items-center gap-1"><Upload className="w-3 h-3 text-green-400" />{ulMB} MB</span>
                            </TableCell>
                            <TableCell className="text-xs">
                              {s.terminateCause ? (
                                <Badge variant="outline" className="text-[10px] text-gray-500">{s.terminateCause}</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">Active</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center">
                          <Signal className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                          <p className="text-sm text-gray-400">No RADIUS sessions found.</p>
                          <p className="text-xs text-gray-400 mt-1">Sessions will appear here once the customer connects via FreeRADIUS.</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ── VPN tab ── */}
            <TabsContent value="vpn" className="m-0">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-500" /> OpenVPN Client Configs
                  </h3>
                  <div className="flex items-center gap-2">
                    {vpnError && (
                      <span className="text-xs text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> {vpnError}
                      </span>
                    )}
                    {!vpnAvailable && (
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                        VPN not available on this server
                      </span>
                    )}
                    {isAdmin && vpnAvailable && (
                      <Button
                        size="sm"
                        onClick={handleIssueVpn}
                        disabled={vpnIssuing}
                        className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white h-7 text-xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {vpnIssuing ? "Issuing…" : "Issue VPN Config"}
                      </Button>
                    )}
                  </div>
                </div>

                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Common Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Remote IP</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead>Revoked</TableHead>
                      <TableHead>Revoked By</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingVpn ? (
                      <TableRow><TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell></TableRow>
                    ) : vpnConfigs && vpnConfigs.configs.length > 0 ? (
                      vpnConfigs.configs.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs text-gray-700">{c.commonName}</TableCell>
                          <TableCell>
                            {c.revokedAt ? (
                              <Badge variant="outline" className="text-[10px] bg-red-50 text-red-600 border-red-200 gap-1">
                                <ShieldOff className="w-3 h-3" /> Revoked
                              </Badge>
                            ) : c.connected ? (
                              <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Connected
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 gap-1">
                                <ShieldCheck className="w-3 h-3" /> Active
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-mono text-gray-500">
                            {c.remoteIp ?? "—"}
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">
                            {new Date(c.issuedAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">
                            {c.revokedAt ? new Date(c.revokedAt).toLocaleDateString() : "—"}
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">{c.revokedBy ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isAdmin && !c.revokedAt && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-gray-500 hover:text-blue-600"
                                  title="Download .ovpn"
                                  onClick={() => {
                                    const a = document.createElement("a");
                                    a.href = `/api/customers/${customerId}/vpn/${c.id}/download`;
                                    a.download = `${c.commonName}.ovpn`;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                  }}
                                >
                                  <ArrowDownToLine className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              {isAdmin && !c.revokedAt && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-gray-500 hover:text-red-600"
                                  title="Revoke certificate"
                                  disabled={vpnRevoking === c.id}
                                  onClick={() => handleRevokeVpn(c.id)}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="py-12 text-center">
                          <FileLock2 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                          <p className="text-sm text-gray-400">No VPN configs issued yet.</p>
                          <p className="text-xs text-gray-400 mt-1">
                            {vpnAvailable
                              ? 'Click "Issue VPN Config" to generate a signed certificate and .ovpn file.'
                              : "Install OpenVPN on the server to enable VPN management."}
                          </p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

          </Tabs>
        </div>
      </div>
    </div>
  );
}
