import { Link, useLocation } from "wouter";
import { signOut } from "@/lib/authClient";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { 
  LayoutDashboard, 
  Users, 
  Package, 
  CreditCard, 
  Receipt, 
  LifeBuoy, 
  ServerCrash, 
  Shield,
  MessageSquare,
  MonitorDot,
  MapPin,
  Smartphone,
  Settings as SettingsIcon,
  LogOut,
  UserCog,
  TrendingUp,
  ClipboardList,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CustomerSearch } from "@/components/customer-search";

interface LayoutProps {
  children: React.ReactNode;
}

const ROLE_LABELS: Record<string, string> = {
  owner:      "Owner",
  admin:      "Admin",
  billing:    "Billing",
  support:    "Support",
  technician: "Tech",
};

const ROLE_COLORS: Record<string, string> = {
  owner:      "bg-slate-900 text-white",
  admin:      "bg-blue-600 text-white",
  billing:    "bg-emerald-600 text-white",
  support:    "bg-orange-500 text-white",
  technician: "bg-purple-600 text-white",
};

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { name, email, role, isOwner, isAdmin, canManageBilling, canManageCustomers, canManageTickets, canManageNetwork } = useCurrentUser();

  const navItems = [
    { name: "Dashboard",     href: "/",             icon: LayoutDashboard, show: !isOwner },
    { name: "Companies",     href: "/companies",    icon: Building2,       show: isOwner },
    { name: "Customers",     href: "/customers",    icon: Users,           show: canManageCustomers },
    { name: "Service Plans", href: "/plans",        icon: Package,         show: canManageBilling },
    { name: "Subscriptions", href: "/subscriptions",icon: CreditCard,      show: canManageBilling },
    { name: "Invoices",      href: "/invoices",     icon: Receipt,         show: canManageBilling },
    { name: "Payments",      href: "/payments",     icon: CreditCard,      show: canManageBilling },
    { name: "Sales",         href: "/sales",        icon: TrendingUp,      show: canManageBilling },
    { name: "M-Pesa Live",   href: "/mpesa",        icon: Smartphone,      show: canManageBilling },
    { name: "Tickets",       href: "/tickets",      icon: LifeBuoy,        show: canManageTickets },
    { name: "Network",       href: "/network",      icon: ServerCrash,     show: canManageNetwork },
    { name: "Network Map",   href: "/map",          icon: MapPin,          show: canManageNetwork },
    { name: "Monitoring",    href: "/monitoring",   icon: MonitorDot,      show: canManageNetwork },
    { name: "Compliance",    href: "/compliance",   icon: Shield,          show: isAdmin },
    { name: "SMS Manager",   href: "/sms",          icon: MessageSquare,   show: isAdmin },
    { name: "Settings",      href: "/settings",     icon: SettingsIcon,    show: isOwner },
    { name: "Staff",         href: "/staff",        icon: UserCog,         show: isAdmin },
    { name: "Audit Log",     href: "/audit-logs",   icon: ClipboardList,   show: isAdmin },
  ].filter(item => item.show);

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row font-sans">
      <aside
        className="w-full md:w-64 flex flex-col shrink-0 sticky top-0 md:h-screen"
        style={{
          background: "hsl(var(--sidebar))",
          color: "hsl(var(--sidebar-foreground))",
          borderRight: "1px solid hsl(var(--sidebar-border))",
        }}
      >
        <div
          className="p-4 flex items-center gap-3"
          style={{ borderBottom: "1px solid hsl(var(--sidebar-border))" }}
        >
          <div
            className="w-8 h-8 rounded flex items-center justify-center font-bold text-sm shadow-sm"
            style={{
              background: "hsl(var(--app-sidebar-logo-bg, var(--sidebar-primary)))",
              color: "hsl(var(--app-sidebar-logo-text, var(--sidebar-primary-foreground)))",
            }}
          >
            NP
          </div>
          <h1 className="font-bold tracking-tight text-lg" style={{ color: "hsl(var(--sidebar-foreground))" }}>
            NetPulse ISP
          </h1>
        </div>
        
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors"
                style={
                  isActive
                    ? {
                        background: "hsl(var(--app-nav-active-bg, var(--sidebar-primary)))",
                        color: "hsl(var(--app-nav-active-text, var(--sidebar-primary-foreground)))",
                      }
                    : {
                        color: "hsl(var(--sidebar-foreground) / 0.75)",
                      }
                }
                onMouseEnter={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent))";
                    (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-accent-foreground))";
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                    (e.currentTarget as HTMLElement).style.color = "hsl(var(--sidebar-foreground) / 0.75)";
                  }
                }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        
        <div
          className="p-4"
          style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-sm"
              style={{
                background: "hsl(var(--sidebar-primary))",
                color: "hsl(var(--sidebar-primary-foreground))",
              }}
            >
              {name?.[0]?.toUpperCase() ?? "A"}
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate" style={{ color: "hsl(var(--sidebar-foreground))" }}>
                  {name ?? "Admin"}
                </span>
                <Badge className={`text-[10px] px-1.5 py-0 h-4 shrink-0 ${ROLE_COLORS[role] ?? "bg-gray-600 text-white"}`}>
                  {ROLE_LABELS[role] ?? role}
                </Badge>
              </div>
              <span className="text-xs truncate" style={{ color: "hsl(var(--sidebar-foreground) / 0.5)" }}>
                {email}
              </span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start h-9 px-3 transition-colors"
            style={{ color: "hsl(var(--sidebar-foreground) / 0.65)" }}
            onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/sign-in"; } } })}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {canManageCustomers && (
          <div
            className="sticky top-0 z-40 px-6 lg:px-8 py-3"
            style={{
              background: "hsl(var(--app-topbar-bg, var(--background)))",
              borderBottom: "1px solid hsl(var(--app-topbar-border, var(--border)))",
            }}
          >
            <div className="mx-auto max-w-6xl flex justify-end">
              <CustomerSearch />
            </div>
          </div>
        )}
        <div className="flex-1 p-6 lg:p-8 overflow-y-auto bg-background">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
