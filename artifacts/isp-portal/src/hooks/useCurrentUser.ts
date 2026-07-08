import { useSession } from "@/lib/authClient";

export type UserRole = "admin" | "billing" | "support" | "technician";

export interface CurrentUser {
  id?: string;
  name?: string;
  email?: string;
  role: UserRole;
  isAdmin: boolean;
  isBilling: boolean;
  isSupport: boolean;
  isTechnician: boolean;
  canManageCustomers: boolean;
  canDeleteCustomers: boolean;
  canManageBilling: boolean;
  canDeleteBillingRecords: boolean;
  canManageNetwork: boolean;
  canDeleteNetworkRecords: boolean;
  canManageTickets: boolean;
}

export function useCurrentUser(): CurrentUser {
  const { data: session } = useSession();
  const raw = session?.user as ({ id?: string; name?: string; email?: string; role?: string }) | undefined;
  const role = (raw?.role ?? "admin") as UserRole;

  return {
    id:    raw?.id,
    name:  raw?.name,
    email: raw?.email,
    role,
    isAdmin:      role === "admin",
    isBilling:    role === "billing",
    isSupport:    role === "support",
    isTechnician: role === "technician",
    canManageCustomers:      role === "admin" || role === "billing" || role === "support",
    canDeleteCustomers:      role === "admin",
    canManageBilling:        role === "admin" || role === "billing",
    canDeleteBillingRecords: role === "admin",
    canManageNetwork:        role === "admin" || role === "technician",
    canDeleteNetworkRecords: role === "admin",
    canManageTickets:        role === "admin" || role === "support",
  };
}
