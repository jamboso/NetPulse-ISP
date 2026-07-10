import { ShieldAlert } from "lucide-react";
import { signOut } from "@/lib/authClient";
import { Button } from "@/components/ui/button";

export default function Suspended() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center p-8 bg-slate-900">
      <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
        <ShieldAlert className="w-8 h-8 text-red-500" />
      </div>
      <h1 className="text-xl font-semibold text-white">Service Suspended</h1>
      <p className="text-sm text-slate-400 max-w-md">
        Your organisation's access has been suspended or its subscription has expired. Please contact your provider to restore access.
      </p>
      <Button
        variant="secondary"
        onClick={() => signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/sign-in"; } } })}
      >
        Sign Out
      </Button>
    </div>
  );
}
