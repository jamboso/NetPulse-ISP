import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, Smartphone } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { useUpdateOwnPhone } from "@workspace/api-client-react";
import { useSession } from "@/lib/authClient";

export function PhoneNumberSection() {
  const { data: session, refetch } = useSession();
  const rawUser = session?.user as { phone?: string | null } | undefined;

  const [phone, setPhone] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPhone(rawUser?.phone ?? "");
  }, [rawUser?.phone]);

  const updateMutation = useUpdateOwnPhone({
    mutation: {
      onSuccess: () => {
        setSuccess(true);
        setError("");
        void refetch();
        setTimeout(() => setSuccess(false), 5000);
      },
      onError: async (err) => {
        try {
          const resp = (err as { response?: Response }).response;
          if (resp) {
            const j = (await resp.json()) as { error?: string };
            setError(j.error ?? "Failed to update phone number.");
            return;
          }
        } catch { /* ignore */ }
        setError("Failed to update phone number.");
      },
    },
  });

  const dirty = phone.trim() !== (rawUser?.phone ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    updateMutation.mutate({ data: { phone: phone.trim() || null } });
  };

  return (
    <SectionCard icon={Smartphone} title="Phone Number">
      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-3 items-start py-3">
          <div className="col-span-4">
            <Label htmlFor="own-phone" className="text-sm font-medium text-gray-700">Phone number</Label>
            <p className="text-xs text-gray-400 mt-0.5">Used to receive SMS password reset codes</p>
          </div>
          <div className="col-span-8">
            <Input
              id="own-phone"
              type="tel"
              placeholder="e.g. 0712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div role="status" className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Phone number updated successfully.
          </div>
        )}

        <div className="flex justify-end pt-4 pb-2">
          <Button
            type="submit"
            disabled={!dirty || updateMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {updateMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
