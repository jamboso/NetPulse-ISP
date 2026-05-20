import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, CreditCard, Network, Bell, Smartphone, Save, CheckCircle2, AlertCircle } from "lucide-react";

type SettingsData = Record<string, string | null>;

function SettingField({
  label, name, value, onChange, type = "text", placeholder, hint, secret,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, val: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  secret?: boolean;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 items-start py-3 border-b border-gray-100 last:border-0">
      <div className="col-span-4">
        <Label className="text-sm font-medium text-gray-700">{label}</Label>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="col-span-8">
        {type === "textarea" ? (
          <Textarea
            rows={2}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(name, e.target.value)}
            className="text-sm resize-none"
          />
        ) : (
          <Input
            type={secret ? "password" : type}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(name, e.target.value)}
            className="text-sm"
          />
        )}
      </div>
    </div>
  );
}

function SelectField({
  label, name, value, onChange, options, hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (name: string, val: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="grid grid-cols-12 gap-3 items-start py-3 border-b border-gray-100 last:border-0">
      <div className="col-span-4">
        <Label className="text-sm font-medium text-gray-700">{label}</Label>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="col-span-8">
        <Select value={value || ""} onValueChange={(v) => onChange(name, v)}>
          <SelectTrigger className="text-sm">
            <SelectValue placeholder="Select..." />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 bg-gray-50 border-b border-gray-200">
        <Icon className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  );
}

export default function Settings() {
  const { data: serverSettings, isLoading } = useGetSettings();
  const updateMutation = useUpdateSettings();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<SettingsData>({});
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (serverSettings) {
      const data: SettingsData = {};
      for (const [k, v] of Object.entries(serverSettings)) {
        data[k] = v ?? "";
      }
      setForm(data);
    }
  }, [serverSettings]);

  const set = (name: string, val: string) => {
    setForm((prev) => ({ ...prev, [name]: val }));
    setDirty(true);
    setSaved(false);
  };

  const f = (name: string) => form[name] ?? "";

  const handleSave = async () => {
    setSaveError("");
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) {
        if (v !== null && v !== undefined) payload[k] = v as string;
      }
      await updateMutation.mutateAsync({ data: payload });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      setSaved(true);
      setDirty(false);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError("Failed to save settings. Please try again.");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Settings</h1>
          <p className="text-gray-500 text-sm">Configure your ISP system preferences.</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {saveError && (
            <span className="flex items-center gap-1.5 text-sm text-red-600">
              <AlertCircle className="w-4 h-4" /> {saveError}
            </span>
          )}
          <Button
            onClick={handleSave}
            disabled={!dirty || updateMutation.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            <Save className="w-4 h-4" />
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="bg-gray-100 flex-wrap h-auto gap-1 p-1">
          <TabsTrigger value="general" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Building2 className="w-3.5 h-3.5" /> General
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <CreditCard className="w-3.5 h-3.5" /> Billing
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Network className="w-3.5 h-3.5" /> Network
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Bell className="w-3.5 h-3.5" /> Notifications
          </TabsTrigger>
          <TabsTrigger value="mpesa" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Smartphone className="w-3.5 h-3.5" /> M-Pesa
          </TabsTrigger>
        </TabsList>

        {/* ── GENERAL ─────────────────────────────────────────────────────── */}
        <TabsContent value="general" className="mt-5 space-y-4">
          <SectionCard icon={Building2} title="Company Information">
            <SettingField label="Company Name" name="companyName" value={f("companyName")} onChange={set} placeholder="Acme ISP Ltd" hint="Shown on invoices and reports" />
            <SettingField label="Address" name="companyAddress" value={f("companyAddress")} onChange={set} type="textarea" placeholder="123 Main St, Nairobi" />
            <SettingField label="Phone" name="companyPhone" value={f("companyPhone")} onChange={set} placeholder="+254 700 000 000" />
            <SettingField label="Email" name="companyEmail" value={f("companyEmail")} onChange={set} placeholder="support@myisp.co.ke" type="email" />
          </SectionCard>

          <SectionCard icon={Building2} title="Regional">
            <SelectField
              label="Timezone"
              name="timezone"
              value={f("timezone")}
              onChange={set}
              hint="System-wide time reference"
              options={[
                { value: "Africa/Nairobi", label: "Africa/Nairobi (EAT UTC+3)" },
                { value: "Africa/Lagos", label: "Africa/Lagos (WAT UTC+1)" },
                { value: "Africa/Johannesburg", label: "Africa/Johannesburg (SAST UTC+2)" },
                { value: "UTC", label: "UTC" },
                { value: "America/New_York", label: "America/New_York (EST/EDT)" },
                { value: "Europe/London", label: "Europe/London (GMT/BST)" },
              ]}
            />
            <SelectField
              label="Currency"
              name="currency"
              value={f("currency")}
              onChange={set}
              options={[
                { value: "KES", label: "KES — Kenyan Shilling" },
                { value: "USD", label: "USD — US Dollar" },
                { value: "EUR", label: "EUR — Euro" },
                { value: "GBP", label: "GBP — British Pound" },
                { value: "UGX", label: "UGX — Ugandan Shilling" },
                { value: "TZS", label: "TZS — Tanzanian Shilling" },
                { value: "NGN", label: "NGN — Nigerian Naira" },
                { value: "ZAR", label: "ZAR — South African Rand" },
              ]}
            />
          </SectionCard>
        </TabsContent>

        {/* ── BILLING ─────────────────────────────────────────────────────── */}
        <TabsContent value="billing" className="mt-5 space-y-4">
          <SectionCard icon={CreditCard} title="Invoice Settings">
            <SettingField label="Invoice Prefix" name="invoicePrefix" value={f("invoicePrefix")} onChange={set} placeholder="INV-" hint="Prepended to invoice numbers" />
            <SettingField label="Due Days" name="invoiceDueDays" value={f("invoiceDueDays")} onChange={set} type="number" placeholder="14" hint="Days after issue before invoice is overdue" />
            <SettingField label="Late Fee %" name="lateFeePercent" value={f("lateFeePercent")} onChange={set} type="number" placeholder="5" hint="Percentage added to overdue invoices" />
          </SectionCard>
          <SectionCard icon={CreditCard} title="Subscription Lifecycle">
            <SettingField label="Auto-Suspend After (days)" name="autoSuspendDays" value={f("autoSuspendDays")} onChange={set} type="number" placeholder="3" hint="Days after due date before account is suspended" />
            <SettingField label="Grace Period (days)" name="gracePeriodDays" value={f("gracePeriodDays")} onChange={set} type="number" placeholder="1" hint="Grace period before suspension kicks in" />
          </SectionCard>
        </TabsContent>

        {/* ── NETWORK ─────────────────────────────────────────────────────── */}
        <TabsContent value="network" className="mt-5 space-y-4">
          <SectionCard icon={Network} title="Router Defaults">
            <SelectField
              label="Default Router Type"
              name="defaultRouterType"
              value={f("defaultRouterType")}
              onChange={set}
              hint="Used when adding new routers without specifying type"
              options={[
                { value: "routeros", label: "MikroTik RouterOS" },
                { value: "juniper", label: "Juniper JunOS" },
                { value: "edgerouter", label: "Ubiquiti EdgeRouter" },
              ]}
            />
            <SettingField label="NTP Server" name="ntpServer" value={f("ntpServer")} onChange={set} placeholder="time.cloudflare.com" hint="Network Time Protocol server for router sync" />
          </SectionCard>
          <SectionCard icon={Network} title="RADIUS">
            <SettingField label="RADIUS Server" name="radiusServer" value={f("radiusServer")} onChange={set} placeholder="192.168.1.10" hint="IP or hostname of RADIUS server" />
            <SettingField label="RADIUS Secret" name="radiusSecret" value={f("radiusSecret")} onChange={set} secret placeholder="shared-secret" hint="RADIUS shared secret" />
          </SectionCard>
        </TabsContent>

        {/* ── NOTIFICATIONS ────────────────────────────────────────────────── */}
        <TabsContent value="notifications" className="mt-5 space-y-4">
          <SectionCard icon={Bell} title="SMS">
            <SelectField
              label="SMS Provider"
              name="smsProvider"
              value={f("smsProvider")}
              onChange={set}
              options={[
                { value: "", label: "Disabled" },
                { value: "africastalking", label: "Africa's Talking" },
                { value: "infobip", label: "Infobip" },
                { value: "twilio", label: "Twilio" },
                { value: "nexmo", label: "Vonage (Nexmo)" },
              ]}
            />
            <SettingField label="API Key" name="smsApiKey" value={f("smsApiKey")} onChange={set} secret placeholder="Your SMS API key" />
            <SettingField label="Sender ID" name="smsSenderId" value={f("smsSenderId")} onChange={set} placeholder="MYISP" hint="Alphanumeric sender name (11 chars max)" />
          </SectionCard>

          <SectionCard icon={Bell} title="Telegram Alerts">
            <SettingField label="Bot Token" name="telegramBotToken" value={f("telegramBotToken")} onChange={set} secret placeholder="123456:ABC-DEF..." hint="From @BotFather on Telegram" />
            <SettingField label="Chat ID" name="telegramChatId" value={f("telegramChatId")} onChange={set} placeholder="-1001234567890" hint="Group/channel chat ID for alerts" />
          </SectionCard>

          <SectionCard icon={Bell} title="Email (SMTP)">
            <SettingField label="SMTP Host" name="smtpHost" value={f("smtpHost")} onChange={set} placeholder="smtp.gmail.com" />
            <SettingField label="SMTP Port" name="smtpPort" value={f("smtpPort")} onChange={set} type="number" placeholder="587" hint="Usually 587 (TLS) or 465 (SSL)" />
            <SettingField label="Username" name="smtpUser" value={f("smtpUser")} onChange={set} placeholder="you@gmail.com" />
            <SettingField label="Password" name="smtpPass" value={f("smtpPass")} onChange={set} secret placeholder="app password" />
            <SettingField label="From Address" name="smtpFrom" value={f("smtpFrom")} onChange={set} placeholder="noreply@myisp.co.ke" hint="Displayed sender in customer emails" />
          </SectionCard>
        </TabsContent>

        {/* ── M-PESA ──────────────────────────────────────────────────────── */}
        <TabsContent value="mpesa" className="mt-5 space-y-4">
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-4 py-2.5">
            <Smartphone className="w-4 h-4 shrink-0" />
            <span>Get credentials at <a href="https://developer.safaricom.co.ke/MyApps" target="_blank" rel="noreferrer" className="underline font-medium">developer.safaricom.co.ke</a>. Save settings, then register URLs.</span>
          </div>

          <SectionCard icon={Smartphone} title="Daraja API Credentials">
            <SelectField
              label="Environment"
              name="mpesaEnv"
              value={f("mpesaEnv")}
              onChange={set}
              hint="Use Sandbox for testing, Live for production"
              options={[
                { value: "sandbox", label: "Sandbox (Testing)" },
                { value: "live", label: "Live (Production)" },
              ]}
            />
            <SettingField label="Consumer Key" name="mpesaConsumerKey" value={f("mpesaConsumerKey")} onChange={set} secret placeholder="Your Daraja consumer key" />
            <SettingField label="Consumer Secret" name="mpesaConsumerSecret" value={f("mpesaConsumerSecret")} onChange={set} secret placeholder="Your Daraja consumer secret" />
            <SettingField label="Business Shortcode" name="mpesaShortcode" value={f("mpesaShortcode")} onChange={set} placeholder="174379 (sandbox)" hint="PayBill or Till number" />
            <SettingField label="Passkey" name="mpesaPasskey" value={f("mpesaPasskey")} onChange={set} secret placeholder="STK Push passkey from Daraja" />
            <SettingField label="Callback URL" name="mpesaCallbackUrl" value={f("mpesaCallbackUrl")} onChange={set} placeholder="https://yourdomain.com/api/mpesa/callback" hint="Must be HTTPS and publicly reachable" />
          </SectionCard>

          <SectionCard icon={Smartphone} title="C2B Plugin Callback URLs">
            <div className="py-3 space-y-2 text-sm text-gray-600">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Register these in the NuxBill C2B plugin settings →</p>
              <div className="grid grid-cols-12 gap-3 items-center py-2 border-b border-gray-100">
                <span className="col-span-4 font-medium text-gray-700">Confirmation URL</span>
                <code className="col-span-8 bg-gray-50 text-blue-700 px-3 py-1.5 rounded text-xs font-mono select-all border border-gray-200">
                  {window.location.origin}/api/mpesa/c2b/confirmation
                </code>
              </div>
              <div className="grid grid-cols-12 gap-3 items-center py-2">
                <span className="col-span-4 font-medium text-gray-700">Validation URL</span>
                <code className="col-span-8 bg-gray-50 text-blue-700 px-3 py-1.5 rounded text-xs font-mono select-all border border-gray-200">
                  {window.location.origin}/api/mpesa/c2b/validation
                </code>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={Smartphone} title="M-Pesa Status">
            <div className="py-3">
              <MpesaStatus />
            </div>
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MpesaStatus() {
  const [status, setStatus] = useState<{ configured: boolean; environment: string; shortcode: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/mpesa/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => null);
  }, []);

  if (!status) return <Skeleton className="h-8 w-48" />;

  return (
    <div className="flex items-center gap-3 text-sm">
      <Badge
        className={status.configured
          ? "bg-green-100 text-green-700 border-green-200"
          : "bg-yellow-100 text-yellow-700 border-yellow-200"}
        variant="outline"
      >
        {status.configured ? "Configured" : "Not configured"}
      </Badge>
      <span className="text-gray-500">
        Environment: <strong>{status.environment}</strong>
        {status.shortcode && <> · Shortcode: <strong>{status.shortcode}</strong></>}
      </span>
    </div>
  );
}
