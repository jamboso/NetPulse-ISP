import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, Router } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";

export function RouterLoginSyncSection() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);
    try {
      const r = await fetch("/api/radius/staff-login/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? "Failed to sync credentials.");
        return;
      }
      setSuccess(true);
      setPassword("");
      setTimeout(() => setSuccess(false), 5000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SectionCard icon={Router} title="Router Login (RADIUS)">
      <p className="text-sm text-gray-500 pb-2">
        Routers with RADIUS admin login enabled (Settings → Network → Router → "Enable RADIUS admin login")
        authenticate Winbox/SSH/web/API access against a separate RADIUS record, not your app login directly.
        Confirm your current app password here to enable logging into those routers with the same email and password.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-3 items-start py-3 border-b border-gray-100">
          <div className="col-span-4">
            <Label className="text-sm font-medium text-gray-700">Current password</Label>
          </div>
          <div className="col-span-8">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter current password"
                className="text-sm pr-9"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div role="status" className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-3">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Router login credentials synced. You can now log into RADIUS-enabled routers with this email and password.
          </div>
        )}

        <div className="flex justify-end pt-4 pb-2">
          <Button
            type="submit"
            disabled={loading || !password}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Syncing…</>
            ) : (
              <><Router className="w-4 h-4" /> Sync Router Login</>
            )}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
