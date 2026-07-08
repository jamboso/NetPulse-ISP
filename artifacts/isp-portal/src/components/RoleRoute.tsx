import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useSession } from "@/lib/authClient";
import { type UserRole } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";

type SessionUser = { role?: string; [key: string]: unknown };

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  billing: "Billing",
  support: "Support",
  technician: "Technician",
};

function formatRoles(roles: UserRole[]): string {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(", ");
}

export function RoleRoute({
  component: Component,
  roles,
}: {
  component: React.ComponentType;
  roles: UserRole[];
}) {
  const { data: session, isPending } = useSession();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const toastedRef = useRef(false);
  const user = session?.user as SessionUser | undefined;
  const role = (user?.role ?? "admin") as UserRole;
  const allowed = roles.includes(role);

  useEffect(() => {
    if (!isPending && user && !allowed && !toastedRef.current) {
      toastedRef.current = true;
      toast({
        title: "Access Denied",
        description: `This page requires one of the following roles: ${formatRoles(roles)}.`,
        variant: "destructive",
      });
      setLocation("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isPending, allowed]);

  if (isPending) return null;
  if (!user || !allowed) return null;
  return <Component />;
}
