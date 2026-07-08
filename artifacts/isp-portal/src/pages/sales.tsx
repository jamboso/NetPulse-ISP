import { useState, useEffect, useCallback } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, Users, CreditCard, BarChart2, Download, RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316"];

function pct(a: number, b: number) {
  if (!b) return "+0%";
  const p = ((a - b) / b) * 100;
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

interface Summary {
  revenueThisMonth: number;
  revenueLastMonth: number;
  newSubsThisMonth: number;
  newSubsLastMonth: number;
  activeSubs: number;
  totalCustomers: number;
  allTimeRevenue: number;
}

interface TrendPoint { date: string; revenue: number; newSubs: number }
interface PlanRow { planId: number; planName: string; price: number; billingCycle: string; subsCount: number; activeSubs: number; mrr: number }
interface StaffRow { email: string; customers: number; subscriptions: number; payments: number; total: number }

function KpiCard({ icon: Icon, label, value, sub, positive }: {
  icon: React.ElementType; label: string; value: string; sub?: string; positive?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4 shadow-sm">
      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-blue-600" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5 truncate">{value}</p>
        {sub && (
          <p className={`text-xs mt-0.5 font-medium ${positive === undefined ? "text-gray-400" : positive ? "text-green-600" : "text-red-500"}`}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export default function Sales() {
  const { fmtMoney: fmt } = useCurrency();
  const [period, setPeriod] = useState<"30d" | "90d" | "12m">("30d");
  const [staffDays, setStaffDays] = useState<"30" | "60" | "90">("30");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [byPlan, setByPlan] = useState<PlanRow[]>([]);
  const [staffActivity, setStaffActivity] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, p, a] = await Promise.all([
        fetch("/api/sales/summary").then((r) => r.json()) as Promise<Summary>,
        fetch(`/api/sales/trends?period=${period}`).then((r) => r.json()) as Promise<{ data: TrendPoint[] }>,
        fetch("/api/sales/by-plan").then((r) => r.json()) as Promise<{ data: PlanRow[] }>,
        fetch(`/api/sales/staff-activity?days=${staffDays}`).then((r) => r.json()) as Promise<{ data: StaffRow[] }>,
      ]);
      setSummary(s);
      setTrends(t.data ?? []);
      setByPlan(p.data ?? []);
      setStaffActivity(a.data ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [period, staffDays]);

  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    const rows = [
      ["Date", "Revenue (KES)", "New Subscriptions"],
      ...trends.map((t) => [t.date, t.revenue, t.newSubs]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sales-report-${period}.csv`;
    a.click();
  }

  const revGrowth = summary ? pct(summary.revenueThisMonth, summary.revenueLastMonth) : "";
  const subsGrowth = summary ? pct(summary.newSubsThisMonth, summary.newSubsLastMonth) : "";
  const revPositive = summary ? summary.revenueThisMonth >= summary.revenueLastMonth : true;
  const subsPositive = summary ? summary.newSubsThisMonth >= summary.newSubsLastMonth : true;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales & Revenue</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track revenue, subscriptions, and field team performance</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-24">
              <Skeleton className="h-3 w-24 mb-3" />
              <Skeleton className="h-7 w-32" />
            </div>
          ))
        ) : summary ? (
          <>
            <KpiCard
              icon={TrendingUp}
              label="Revenue this month"
              value={fmt(summary.revenueThisMonth)}
              sub={`${revGrowth} vs last month`}
              positive={revPositive}
            />
            <KpiCard
              icon={CreditCard}
              label="New subscriptions"
              value={String(summary.newSubsThisMonth)}
              sub={`${subsGrowth} vs last month`}
              positive={subsPositive}
            />
            <KpiCard icon={Activity} label="Active subscriptions" value={String(summary.activeSubs)} />
            <KpiCard icon={Users} label="Total customers" value={String(summary.totalCustomers)} />
          </>
        ) : null}
      </div>

      {/* Trends chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="font-semibold text-gray-800">Revenue & Subscriptions Trend</h2>
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-32 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="12m">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={trends} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                yAxisId="rev"
                orientation="left"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
              />
              <YAxis
                yAxisId="subs"
                orientation="right"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                formatter={(value: number, name: string) =>
                  name === "revenue" ? [fmt(value), "Revenue"] : [value, "New Subs"]
                }
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="rev" type="monotone" dataKey="revenue" name="revenue" stroke="#3b82f6" fill="url(#revGrad)" strokeWidth={2} dot={false} />
              <Bar yAxisId="subs" dataKey="newSubs" name="newSubs" fill="#10b981" opacity={0.7} radius={[2, 2, 0, 0]} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Plan breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-blue-500" />
            Revenue by Plan (MRR)
          </h2>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byPlan} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
                <YAxis dataKey="planName" type="category" tick={{ fontSize: 11, fill: "#374151" }} tickLine={false} axisLine={false} width={90} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  formatter={(v: number) => [fmt(v), "MRR"]}
                />
                <Bar dataKey="mrr" name="mrr" radius={[0, 4, 4, 0]}>
                  {byPlan.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h2 className="font-semibold text-gray-800 mb-4">Active Subscribers by Plan</h2>
          {loading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="55%" height={220}>
                <PieChart>
                  <Pie
                    data={byPlan.filter((p) => p.activeSubs > 0)}
                    dataKey="activeSubs"
                    nameKey="planName"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {byPlan.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                    formatter={(v: number) => [v, "Subscribers"]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2 min-w-0">
                {byPlan.filter((p) => p.activeSubs > 0).map((p, i) => (
                  <div key={p.planId} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="truncate text-gray-700 font-medium">{p.planName}</span>
                    <span className="ml-auto text-gray-500 shrink-0">{p.activeSubs}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Staff activity */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4 gap-4">
          <h2 className="font-semibold text-gray-800">Field Team Performance</h2>
          <Select value={staffDays} onValueChange={(v) => setStaffDays(v as typeof staffDays)}>
            <SelectTrigger className="w-36 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : staffActivity.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No activity recorded yet. Staff actions (creating customers, subscriptions, payments) appear here once they start working.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="font-medium">Staff Email</TableHead>
                <TableHead className="text-right font-medium">Customers</TableHead>
                <TableHead className="text-right font-medium">Subscriptions</TableHead>
                <TableHead className="text-right font-medium">Payments</TableHead>
                <TableHead className="text-right font-medium">Total Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staffActivity.map((s) => (
                <TableRow key={s.email} className="hover:bg-gray-50">
                  <TableCell className="font-medium text-gray-800">{s.email}</TableCell>
                  <TableCell className="text-right text-gray-600">{s.customers}</TableCell>
                  <TableCell className="text-right text-gray-600">{s.subscriptions}</TableCell>
                  <TableCell className="text-right text-gray-600">{s.payments}</TableCell>
                  <TableCell className="text-right">
                    <span className="font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full text-xs">{s.total}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-gray-400 mt-3">
          Counts creation actions logged in audit trail for the selected period. Only admin and billing roles can view this.
        </p>
      </div>
    </div>
  );
}
