import { Link, useLocation } from "wouter";
import { MapPin, MonitorDot, ServerCrash, Users } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const items = [
  { name: "Customers", href: "/customers", icon: Users },
  { name: "Network", href: "/network", icon: ServerCrash },
  { name: "Monitoring", href: "/monitoring", icon: MonitorDot },
  { name: "Network Map", href: "/map", icon: MapPin },
] as const;

export function CustomerWorkspaceSidebar() {
  const [location] = useLocation();
  const { canManageNetwork } = useCurrentUser();

  return (
    <aside
      className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm lg:sticky lg:top-6"
    >
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        Customer workspace
      </p>
      <nav className="space-y-1" aria-label="Customer workspace navigation">
        {items.map(({ name, href, icon: Icon }) => {
          const isActive = location === href || (href !== "/customers" && location.startsWith(href));
          const isNetworkItem = href !== "/customers";
          if (isNetworkItem && !canManageNetwork) return null;

          return (
            <Link
              key={name}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}