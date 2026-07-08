import './_group.css';
import './_night-ops.css';
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
  { label: 'Total Customers', value: '1,248', icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-950/30' },
  { label: 'Active Subscriptions', value: '1,102', icon: CreditCard, color: 'text-emerald-400', bg: 'bg-emerald-950/30' },
  { label: 'Monthly Revenue', value: 'KES 4.2M', icon: DollarSign, color: 'text-cyan-400', bg: 'bg-cyan-950/30' },
  { label: 'Overdue Invoices', value: '18', icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-950/30' },
  { label: 'Open Tickets', value: '7', icon: LifeBuoy, color: 'text-amber-400', bg: 'bg-amber-950/30' },
  { label: 'Total Equipment', value: '346', icon: ServerCrash, color: 'text-indigo-400', bg: 'bg-indigo-950/30' },
];

const ACTIVITY = [
  { title: 'Payment received', desc: 'Jane Wanjiru paid KES 3,500 for Fiber 20Mbps', time: 'Jul 8, 2026 2:14 PM' },
  { title: 'Ticket opened', desc: 'David Otieno reported intermittent connectivity', time: 'Jul 8, 2026 1:02 PM' },
  { title: 'Subscription created', desc: 'New PPPoE subscription for Grace Muthoni', time: 'Jul 8, 2026 11:47 AM' },
  { title: 'Router alert cleared', desc: 'Kilimani-AP-03 back online', time: 'Jul 8, 2026 10:20 AM' },
];

export function NightOps() {
  return (
    <div className="night-ops min-h-screen flex selection:bg-cyan-500/30">
      <aside className="w-60 bg-black border-r border-slate-800 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-800 flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-500 flex items-center justify-center font-bold text-black glow-cyan">NP</div>
          <h1 className="font-bold tracking-tight text-lg text-white uppercase tracking-widest">NetPulse</h1>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.name}
                className={`flex items-center gap-3 px-3 py-1.5 text-xs font-medium rounded transition-all cursor-pointer ${
                  item.active 
                    ? 'bg-cyan-950/50 text-cyan-400 border border-cyan-500/30 glow-cyan' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-cyan-300'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${item.active ? 'text-cyan-400' : ''}`} />
                {item.name}
              </div>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-7 h-7 rounded bg-cyan-900/50 border border-cyan-500/30 flex items-center justify-center shrink-0 text-cyan-400 font-bold text-xs">AK</div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold truncate text-white uppercase">Alice Kamau</span>
              <span className="text-[10px] text-slate-500 truncate font-mono">ID: ADMIN_01</span>
            </div>
          </div>
          <div className="w-full flex items-center gap-2 text-slate-400 hover:text-rose-400 transition-colors text-xs px-3 py-1.5 cursor-pointer">
            <LogOut className="w-3.5 h-3.5" /> SIGN OUT
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-[#020617] relative">
        {/* Decorative Scanline effect */}
        <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.02),rgba(0,255,0,0.01),rgba(0,0,255,0.02))] bg-[length:100%_4px,3px_100%]" />
        
        <div className="dashboard-container mx-auto max-w-6xl space-y-5 relative z-10">
          <div className="flex justify-between items-end border-b border-slate-800 pb-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
                <h1 className="text-xl font-bold tracking-tight text-white uppercase tracking-tighter">Command_Center_v2.0</h1>
              </div>
              <p className="text-slate-500 text-[10px] font-mono tracking-wide uppercase">NOC Operations // System Stability: 99.98%</p>
            </div>
            <div className="text-[10px] font-mono text-cyan-500/60 bg-cyan-950/20 px-2 py-1 rounded border border-cyan-500/20">
              LOC: NAIROBI_HQ_GATEWAY
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 grid-gap">
            {METRICS.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.label} className="metric-card p-4 rounded flex items-center gap-4 group relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-white/5 rotate-45 translate-x-10 -translate-y-10 group-hover:bg-cyan-500/10 transition-colors" />
                  <div className={`p-2.5 rounded border border-current/20 ${metric.bg} ${metric.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="z-10">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{metric.label}</p>
                    <h3 className="text-xl font-bold text-white font-mono mt-0.5">{metric.value}</h3>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-slate-900/50 rounded border border-slate-800 overflow-hidden shadow-2xl backdrop-blur-sm">
            <div className="px-5 py-3 border-b border-slate-800 flex justify-between items-center bg-black/20">
              <h3 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-widest">
                <Activity className="w-4 h-4 text-cyan-500" /> System_Logs
              </h3>
              <div className="text-[10px] font-mono text-slate-500">
                LIVE_FEED
              </div>
            </div>
            <div className="divide-y divide-slate-800/50">
              {ACTIVITY.map((a) => (
                <div key={a.title + a.time} className="p-3.5 flex items-start gap-4 hover:bg-slate-800/30 transition-colors group">
                  <div className="mt-1.5 w-1.5 h-1.5 rounded bg-cyan-500 shadow-[0_0_5px_rgba(34,211,238,0.8)] shrink-0 group-hover:scale-125 transition-transform" />
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <p className="text-xs text-cyan-300 font-bold uppercase tracking-tight">{a.title}</p>
                      <p className="text-[10px] text-slate-500 font-mono">{a.time}</p>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{a.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-slate-800 bg-black/40 text-center">
              <button className="text-[9px] font-mono text-slate-600 hover:text-cyan-500 uppercase tracking-[0.2em] transition-colors">
                View_Full_Diagnostic_Log
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
