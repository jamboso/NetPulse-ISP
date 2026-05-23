import { useEffect } from "react";
import { useLocation } from "wouter";
import { useSession } from "@/lib/authClient";
import { type UserRole } from "@/hooks/useCurrentUser";

type SessionUser = { role?: string; [key: string]: unknown };

export function RoleRoute({
  component: Component,
  roles,
}: {
  component: React.ComponentType;
  roles: UserRole[];
}) {
  const { data: session, isPending } = useSession();
  const [, setLocation] = useLocation();
  const user = session?.user as SessionUser | undefined;
  const role = (user?.role ?? "admin") as UserRole;
  const allowed = roles.includes(role);

  useEffect(() => {
    if (!isPending && user && !allowed) {
      setLocation("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isPending, setLocation, allowed]);

  if (isPending) return null;
  if (!user || !allowed) return null;
  return <Component />;
}
