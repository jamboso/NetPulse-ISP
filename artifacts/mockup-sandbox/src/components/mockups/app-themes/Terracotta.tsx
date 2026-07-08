import './_terracotta.css';
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
  { label: 'Total Customers', value: '1,248', icon: Users, color: 'text-orange-700', bg: 'bg-orange-100' },
  { label: 'Active Subscriptions', value: '1,102', icon: CreditCard, color: 'text-amber-700', bg: 'bg-amber-100' },
  { label: 'Monthly Revenue', value: 'KES 4.2M', icon: DollarSign, color: 'text-stone-700', bg: 'bg-stone-200' },
  { label: 'Overdue Invoices', value: '18', icon: AlertTriangle, color: 'text-red-700', bg: 'bg-red-100' },
  { label: 'Open Tickets', value: '7', icon: LifeBuoy, color: 'text-yellow-700', bg: 'bg-yellow-100' },
  { label: 'Total Equipment', value: '346', icon: ServerCrash, color: 'text-orange-800', bg: 'bg-orange-200' },
];

const ACTIVITY = [
  { title: 'Payment received', desc: 'Jane Wanjiru paid KES 3,500 for Fiber 20Mbps', time: 'Jul 8, 2026 2:14 PM' },
  { title: 'Ticket opened', desc: 'David Otieno reported intermittent connectivity', time: 'Jul 8, 2026 1:02 PM' },
  { title: 'Subscription created', desc: 'New PPPoE subscription for Grace Muthoni', time: 'Jul 8, 2026 11:47 AM' },
  { title: 'Router alert cleared', desc: 'Kilimani-AP-03 back online', time: 'Jul 8, 2026 10:20 AM' },
];

export function Terracotta() {
  return (
    <div className="terracotta-root min-h-screen bg-[#FFFDF9] flex text-[#2D241E]">
      <aside className="w-72 bg-[#F8F5F0] border-r border-[#E5E0D5] flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#CC5500] flex items-center justify-center font-bold text-white shadow-lg shadow-orange-900/20">NP</div>
          <h1 className="font-bold tracking-tight text-xl text-[#4A3728]">NetPulse</h1>
        </div>
        <nav className="flex-1 py-2 px-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 ${
                  item.active 
                    ? 'bg-[#CC5500] text-white shadow-md shadow-orange-900/10' 
                    : 'text-[#6D5C4E] hover:bg-[#EFEAE2] hover:text-[#2D241E]'
                }`}
              >
                <Icon className={`w-4.5 h-4.5 shrink-0 ${item.active ? 'text-white' : 'text-[#A8907E]'}`} />
                {item.name}
              </div>
            );
          })}
        </nav>
        <div className="p-6 border-t border-[#E5E0D5]">
          <div className="flex items-center gap-3 p-3 bg-white rounded-2xl shadow-sm border border-[#F0EDE5] mb-4">
            <div className="w-9 h-9 rounded-full bg-[#E58E58] flex items-center justify-center shrink-0 text-white font-bold text-sm">A</div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-bold text-[#4A3728] truncate">Alice Kamau</span>
              <span className="text-xs text-[#8B7E74] truncate">Admin Account</span>
            </div>
          </div>
          <div className="w-full flex items-center gap-2 text-[#8B7E74] hover:text-[#CC5500] transition-colors cursor-pointer text-sm font-semibold px-3 py-2">
            <LogOut className="w-4 h-4" /> Sign Out
          </div>
        </div>
      </aside>

      <main className="flex-1 p-10 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-10">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-extrabold tracking-tight text-[#2D241E]">Command Center</h1>
            <p className="text-[#8B7E74] text-base">System overview and key performance metrics.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {METRICS.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="bg-white p-6 rounded-[2rem] border border-[#F0EDE5] card-shadow flex items-center gap-5 transition-transform hover:scale-[1.02]">
                  <div className={`p-4 rounded-2xl ${metric.bg} ${metric.color}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#A8907E] mb-0.5">{metric.label}</p>
                    <h3 className="text-3xl font-black text-[#2D241E]">{metric.value}</h3>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-[2rem] border border-[#F0EDE5] card-shadow overflow-hidden">
            <div className="p-8 border-b border-[#F0EDE5] flex items-center justify-between">
              <h3 className="text-xl font-bold text-[#2D241E] flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-50">
                  <Activity className="w-5 h-5 text-[#CC5500]" />
                </div>
                Recent Activity
              </h3>
              <button className="text-sm font-bold text-[#CC5500] hover:underline">View All</button>
            </div>
            <div className="divide-y divide-[#F5F2EB]">
              {ACTIVITY.map((a) => (
                <div key={a.title + a.time} className="p-6 flex items-start gap-5 hover:bg-[#FFFDF9] transition-colors">
                  <div className="mt-2 w-2.5 h-2.5 rounded-full bg-[#CC5500] shrink-0 shadow-sm shadow-orange-900/40" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-base text-[#2D241E] font-bold">{a.title}</p>
                      <p className="text-xs font-medium text-[#A8907E]">{a.time}</p>
                    </div>
                    <p className="text-sm text-[#6D5C4E] mt-1 leading-relaxed">{a.desc}</p>
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
