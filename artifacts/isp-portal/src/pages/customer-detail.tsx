import { useParams, Link } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { useMacVendor } from "@/hooks/useMacVendor";
import {
  useGetCustomer,
  useListSubscriptions,
  useListInvoices,
  useListTickets,
  useGetCustomerSessions,
  useGetCustomerUsageSnapshots,
  useSaveUsageSnapshot,
  type CustomerSession,
} from "@workspace/api-client-react";
import {
  User, Mail, Phone, MapPin, Calendar, CreditCard, Receipt,
  LifeBuoy, ArrowLeft, Edit, KeyRound, Wifi, WifiOff, Signal,
  Eye, EyeOff, RefreshCw, Download, Upload, Clock, Cpu,
  MonitorSmartphone, AlertCircle, Router,
} from "lucide-react";
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

  // Build chart data: delta between consecutive snapshots (KB transferred per interval)
  const chartData = snapshots.map((s, i) => {
    const prev = snapshots[i - 1];
    return {
      time: fmtTime(s.recordedAt),
      download: prev ? Math.round(Math.max(0, s.bytesIn  - prev.bytesIn)  / 1024) : 0,
      upload:   prev ? Math.round(Math.max(0, s.bytesOut - prev.bytesOut) / 1024) : 0,
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
        {chartData.length >= 2 ? (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
              <Signal className="w-3 h-3" /> Usage per Interval (KB / 30 s)
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
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  formatter={(v: number, name: string) => [`${v} KB`, name === "download" ? "↓ Download" : "↑ Upload"]}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "download" ? "↓ Download" : "↑ Upload"} />
                <Area type="monotone" dataKey="download" stroke="#22c55e" strokeWidth={2} fill={`url(#dl-${session.subscriptionId})`} dot={false} />
                <Area type="monotone" dataKey="upload" stroke="#f97316" strokeWidth={2} fill={`url(#ul-${session.subscriptionId})`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : chartData.length === 1 ? (
          <p className="text-xs text-gray-400 text-center py-2">
            Collecting data… graph will appear after the next refresh.
          </p>
        ) : (
          <p className="text-xs text-gray-400 text-center py-2">
            No usage history yet. Data is recorded each time this page refreshes.
          </p>
        )}
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
          { label: "Total Billed",  value: `KES ${totalBilled.toLocaleString()}`,   color: "text-gray-900" },
          { label: "Total Paid",    value: `KES ${totalPaid.toLocaleString()}`,      color: "text-green-600" },
          { label: "Outstanding",   value: `KES ${outstanding.toLocaleString()}`,    color: outstanding > 0 ? "text-red-500" : "text-gray-400" },
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
              `KES ${v.toLocaleString()}`,
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
  const { id } = useParams();
  const customerId = parseInt(id || "0", 10);

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

  const saveSnapshot = useSaveUsageSnapshot();
  const lastSavedAt = useRef(0);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => { refetchSessions(); }, 30_000);
    return () => clearInterval(id);
  }, [refetchSessions]);

  // After each live session fetch, persist a snapshot for graphing
  useEffect(() => {
    if (!sessions || !Array.isArray(sessions)) return;
    const onlineSessions = sessions.filter((s: Session) => s.status === "online");
    if (onlineSessions.length === 0) return;
    // Debounce — only save once per refetch cycle
    if (Date.now() - lastSavedAt.current < 20_000) return;
    lastSavedAt.current = Date.now();

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
  }, [dataUpdatedAt]);

  const handleRefresh = useCallback(() => {
    lastSavedAt.current = 0;
    refetchSessions();
  }, [refetchSessions]);

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
        <Button variant="outline" className="bg-white">
          <Edit className="w-4 h-4 mr-2" /> Edit Profile
        </Button>
      </div>

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
          <Tabs defaultValue="overview" className="w-full">
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
                          <TableCell className="font-medium text-gray-900">${(invoice.total ?? invoice.amount).toFixed(2)}</TableCell>
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
          </Tabs>
        </div>
      </div>
    </div>
  );
}
