import { useGetDashboardSummary, useGetRevenueStats, useGetSubscriptionBreakdown, useGetRecentActivity } from "@workspace/api-client-react";
import { 
  Users, 
  CreditCard, 
  AlertTriangle, 
  DollarSign,
  LifeBuoy,
  ServerCrash,
  Activity
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
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
  Legend
} from "recharts";

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

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Command Center</h1>
        <p className="text-gray-500 text-sm">System overview and key performance metrics.</p>
      </div>

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
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Revenue Overview</h3>
          <div className="h-[300px]">
            {loadingRevenue ? (
              <Skeleton className="w-full h-full" />
            ) : revenueStats && revenueStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueStats} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} dy={10} />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [`$${value}`, 'Revenue']}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} activeDot={{ r: 6, strokeWidth: 0 }} />
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
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
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
                    {activity.type.charAt(0).toUpperCase() + activity.type.slice(1).replace('_', ' ')}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">{activity.description}</p>
                  <p className="text-xs text-gray-400 mt-1">{format(new Date(activity.timestamp), 'MMM d, yyyy h:mm a')}</p>
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
