import { useGetDashboardSummary, useGetRevenueStats, useGetSubscriptionBreakdown, useGetRecentActivity, useGetRoutersStatus, type RouterStatus } from "@workspace/api-client-react";
import { useEffect } from "react";
import {
  Users,
  CreditCard,
  AlertTriangle,
  DollarSign,
  LifeBuoy,
  ServerCrash,
  Activity,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
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
              {formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })}
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
          {r.ipAddress}{r.port ? `:${r.port}` : ""}
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
            <WifiOff className="w-3 h-3" /> Unreachable
          </span>
        )}
        {r.lastSeen && (
          <span className="text-gray-400 ml-auto truncate">
            {formatDistanceToNow(new Date(r.lastSeen), { addSuffix: true })}
          </span>
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

  const metrics = [
    { label: "Total Customers", value: summary?.totalCustomers, icon: Users, color: "text-blue-500", bg: "bg-blue-50" },
    { label: "Active Subscriptions", value: summary?.activeSubscriptions, icon: CreditCard, color: "text-green-500", bg: "bg-green-50" },
    { label: "Monthly Revenue", value: summary?.monthlyRevenue ? `$${summary.monthlyRevenue.toLocaleString()}` : undefined, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-50" },
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

      {/* Router Live Status */}
      <RouterStatusPanel />

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
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    formatter={(value: number) => [`$${value}`, "Revenue"]}
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
                  <p className="text-xs text-gray-400 mt-1">{format(new Date(activity.timestamp), "MMM d, yyyy h:mm a")}</p>
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
