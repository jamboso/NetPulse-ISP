import './_group.css';
import {
  LayoutDashboard, Users, Package, CreditCard, Receipt, LifeBuoy,
  ServerCrash, Shield, MessageSquare, MonitorDot, MapPin, Smartphone,
  Settings as SettingsIcon, LogOut, UserCog, TrendingUp, ClipboardList,
  DollarSign, AlertTriangle, Activity,
} from 'lucide-react';

const NAV_ITEMS = [
  { name: 'Dashboard', icon: LayoutDashboard, active: true },
  { name: 'Customers', icon: Users },
  { name: 'Service Plans', icon: Package },
  { name: 'Subscriptions', icon: CreditCard },
  { name: 'Invoices', icon: Receipt },
  { name: 'Payments', icon: CreditCard },
  { name: 'Sales', icon: TrendingUp },
  { name: 'M-Pesa Live', icon: Smartphone },
  { name: 'Tickets', icon: LifeBuoy },
  { name: 'Network', icon: ServerCrash },
  { name: 'Network Map', icon: MapPin },
  { name: 'Monitoring', icon: MonitorDot },
  { name: 'Compliance', icon: Shield },
  { name: 'SMS Manager', icon: MessageSquare },
  { name: 'Settings', icon: SettingsIcon },
  { name: 'Staff', icon: UserCog },
  { name: 'Audit Log', icon: ClipboardList },
];

const METRICS = [
  { label: 'Total Customers', value: '1,248', icon: Users, color: 'text-blue-500', bg: 'bg-blue-50' },
  { label: 'Active Subscriptions', value: '1,102', icon: CreditCard, color: 'text-green-500', bg: 'bg-green-50' },
  { label: 'Monthly Revenue', value: 'KES 4.2M', icon: DollarSign, color: 'text-emerald-500', bg: 'bg-emerald-50' },
  { label: 'Overdue Invoices', value: '18', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
  { label: 'Open Tickets', value: '7', icon: LifeBuoy, color: 'text-orange-500', bg: 'bg-orange-50' },
  { label: 'Total Equipment', value: '346', icon: ServerCrash, color: 'text-purple-500', bg: 'bg-purple-50' },
];

const ACTIVITY = [
  { title: 'Payment received', desc: 'Jane Wanjiru paid KES 3,500 for Fiber 20Mbps', time: 'Jul 8, 2026 2:14 PM' },
  { title: 'Ticket opened', desc: 'David Otieno reported intermittent connectivity', time: 'Jul 8, 2026 1:02 PM' },
  { title: 'Subscription created', desc: 'New PPPoE subscription for Grace Muthoni', time: 'Jul 8, 2026 11:47 AM' },
  { title: 'Router alert cleared', desc: 'Kilimani-AP-03 back online', time: 'Jul 8, 2026 10:20 AM' },
];

export function Current() {
  return (
    <div className="app-themes-root min-h-screen bg-background flex text-foreground">
      <aside className="w-64 bg-[#0a192f] text-white flex flex-col shrink-0">
        <div className="p-4 border-b border-[#112240] flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-500 flex items-center justify-center font-bold text-white shadow-lg">NP</div>
          <h1 className="font-bold tracking-tight text-lg">NetPulse ISP</h1>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  item.active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-[#112240] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.name}
              </div>
            );
          })}
        </nav>
        <div className="p-4 border-t border-[#112240]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 text-white font-bold text-sm">A</div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate">Alice Kamau</span>
              <span className="text-xs text-gray-400 truncate">admin@netpulse.co.ke</span>
            </div>
          </div>
          <div className="w-full flex items-center gap-2 text-gray-300 text-sm px-3 py-2">
            <LogOut className="w-4 h-4" /> Sign Out
          </div>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">Command Center</h1>
            <p className="text-gray-500 text-sm">System overview and key performance metrics.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {METRICS.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex items-center gap-4">
                  <div className={`p-3 rounded-md ${metric.bg} ${metric.color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">{metric.label}</p>
                    <h3 className="text-2xl font-bold text-gray-900">{metric.value}</h3>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Activity className="w-5 h-5 text-gray-500" /> Recent Activity
              </h3>
            </div>
            <div className="divide-y divide-gray-100">
              {ACTIVITY.map((a) => (
                <div key={a.title + a.time} className="p-4 flex items-start gap-4">
                  <div className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <div>
                    <p className="text-sm text-gray-900 font-medium">{a.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{a.desc}</p>
                    <p className="text-xs text-gray-400 mt-1">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
