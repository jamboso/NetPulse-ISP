import './_daylight.css';
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
  { label: 'Total Customers', value: '1,248', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50/50' },
  { label: 'Active Subscriptions', value: '1,102', icon: CreditCard, color: 'text-emerald-600', bg: 'bg-emerald-50/50' },
  { label: 'Monthly Revenue', value: 'KES 4.2M', icon: DollarSign, color: 'text-blue-700', bg: 'bg-blue-50/50' },
  { label: 'Overdue Invoices', value: '18', icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50/50' },
  { label: 'Open Tickets', value: '7', icon: LifeBuoy, color: 'text-amber-600', bg: 'bg-amber-50/50' },
  { label: 'Total Equipment', value: '346', icon: ServerCrash, color: 'text-slate-600', bg: 'bg-slate-50/50' },
];

const ACTIVITY = [
  { title: 'Payment received', desc: 'Jane Wanjiru paid KES 3,500 for Fiber 20Mbps', time: 'Jul 8, 2026 2:14 PM' },
  { title: 'Ticket opened', desc: 'David Otieno reported intermittent connectivity', time: 'Jul 8, 2026 1:02 PM' },
  { title: 'Subscription created', desc: 'New PPPoE subscription for Grace Muthoni', time: 'Jul 8, 2026 11:47 AM' },
  { title: 'Router alert cleared', desc: 'Kilimani-AP-03 back online', time: 'Jul 8, 2026 10:20 AM' },
];

export function Daylight() {
  return (
    <div className="daylight-root min-h-screen bg-white flex text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      <aside className="w-64 bg-[#f8fafc] border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm ring-4 ring-blue-50">NP</div>
          <h1 className="font-bold tracking-tight text-lg text-slate-900">NetPulse</h1>
        </div>
        
        <nav className="flex-1 px-4 pb-4 space-y-0.5 overflow-y-auto">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-3 mb-2 mt-4">Menu</div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className={`sidebar-item flex items-center gap-3 px-3 py-2 text-[13px] font-medium rounded-lg cursor-pointer ${
                  item.active ? 'sidebar-item-active' : ''
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${item.active ? 'text-blue-600' : 'text-slate-400'}`} />
                {item.name}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 bg-slate-50/50">
          <div className="flex items-center gap-3 p-2">
            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center shrink-0 text-blue-600 font-bold text-xs">AK</div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold text-slate-900 truncate">Alice Kamau</span>
              <span className="text-[10px] text-slate-500 truncate">Administrator</span>
            </div>
          </div>
          <button className="w-full flex items-center gap-2 text-slate-500 hover:text-rose-600 text-xs px-3 py-2 transition-colors mt-2">
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 p-10 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Command Center</h1>
            <p className="text-slate-500 text-sm font-medium">Real-time infrastructure monitoring and business analytics.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {METRICS.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="stat-card p-6 flex flex-col gap-4">
                  <div className={`w-10 h-10 rounded-xl ${metric.bg} ${metric.color} flex items-center justify-center`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{metric.label}</p>
                    <h3 className="text-3xl font-bold text-slate-900 mt-1">{metric.value}</h3>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 uppercase tracking-tight">
                <Activity className="w-4 h-4 text-blue-500" /> Recent Operations
              </h3>
              <button className="text-xs font-semibold text-blue-600 hover:underline">View All</button>
            </div>
            <div className="divide-y divide-slate-50 px-4">
              {ACTIVITY.map((a) => (
                <div key={a.title + a.time} className="activity-item p-4 rounded-xl transition-colors flex items-start gap-4">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0 ring-4 ring-blue-50" />
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <p className="text-sm text-slate-900 font-semibold">{a.title}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{a.time}</p>
                    </div>
                    <p className="text-sm text-slate-500 mt-1 leading-relaxed">{a.desc}</p>
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
