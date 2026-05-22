import { Link, useLocation } from "wouter";
import { useSession, signOut } from "@/lib/authClient";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: session } = useSession();
  const user = session?.user;

  const role = (user as (typeof user & { role?: string }) | undefined)?.role ?? "";
  const isAdmin = role === "admin";

  const allNavItems: { name: string; href: string; icon: React.ElementType; roles?: string[] }[] = [
    { name: "Dashboard", href: "/" , icon: LayoutDashboard },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Service Plans", href: "/plans", icon: Package },
    { name: "Subscriptions", href: "/subscriptions", icon: CreditCard },
    { name: "Invoices", href: "/invoices", icon: Receipt },
    { name: "Payments", href: "/payments", icon: CreditCard },
    { name: "Sales", href: "/sales", icon: TrendingUp, roles: ["admin", "billing"] },
    { name: "M-Pesa Live", href: "/mpesa", icon: Smartphone },
    { name: "Tickets", href: "/tickets", icon: LifeBuoy },
    { name: "Network", href: "/network", icon: ServerCrash, roles: ["admin", "technician"] },
    { name: "Network Map", href: "/map", icon: MapPin, roles: ["admin", "technician"] },
    { name: "Monitoring", href: "/monitoring", icon: MonitorDot, roles: ["admin", "technician"] },
    { name: "Compliance", href: "/compliance", icon: Shield, roles: ["admin"] },
    { name: "SMS Manager", href: "/sms", icon: MessageSquare, roles: ["admin"] },
    { name: "Settings", href: "/settings", icon: SettingsIcon, roles: ["admin"] },
    { name: "Staff", href: "/staff", icon: UserCog, roles: ["admin"] },
  ];

  const navItems = allNavItems.filter((item) =>
    !item.roles || item.roles.includes(role) || role === "admin"
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans">
      <aside className="w-full md:w-64 bg-[#0a192f] text-white flex flex-col shrink-0 sticky top-0 md:h-screen">
        <div className="p-4 border-b border-[#112240] flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-500 flex items-center justify-center font-bold text-white shadow-lg">
            NP
          </div>
          <h1 className="font-bold tracking-tight text-lg">NetPulse ISP</h1>
        </div>
        
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive 
                    ? "bg-blue-600 text-white" 
                    : "text-gray-300 hover:bg-[#112240] hover:text-white"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>
        
        <div className="p-4 border-t border-[#112240]">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 text-white font-bold text-sm">
              {user?.name?.[0]?.toUpperCase() ?? "A"}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{user?.name ?? "Admin"}</span>
              <span className="text-xs text-gray-400 truncate">{user?.email}</span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-gray-300 hover:text-white hover:bg-[#112240] h-9 px-3"
            onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/sign-in"; } } })}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
