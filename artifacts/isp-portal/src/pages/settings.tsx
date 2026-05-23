import { useState, useEffect } from "react";
import { useGetSettings, useUpdateSettings, useSendTestEmail, useGetMpesaIpAllowlist } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, CreditCard, Network, Bell, Smartphone, Save, CheckCircle2, AlertCircle, MessageSquare, Send, Loader2, Shield, RefreshCw, Link2, UserCircle } from "lucide-react";
import { InfrastructureTab } from "./infrastructure-tab";
import { UpdatesTab } from "./updates-tab";
import { SectionCard } from "@/components/SectionCard";
import { ChangePasswordSection } from "@/components/ChangePasswordSection";

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


function SendTestEmailButton() {
  const mutation = useSendTestEmail();
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSend = async () => {
    setResult(null);
    try {
      const data = await mutation.mutateAsync();
      setResult({ success: data.success, message: data.message });
    } catch {
      setResult({ success: false, message: "Request failed — check the console" });
    }
  };

  return (
    <div className="flex items-center gap-3 pt-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleSend}
        disabled={mutation.isPending}
        className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
      >
        {mutation.isPending
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Send className="w-3.5 h-3.5" />}
        {mutation.isPending ? "Sending…" : "Send Test Email"}
      </Button>
      {result?.success && (
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {result.message}
        </span>
      )}
      {result && !result.success && (
        <span className="flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5" />
          {result.message}
        </span>
      )}
    </div>
  );
}

function RadiusResyncButton() {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [result, setResult] = useState<{ synced: number; skipped: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const handleSync = async () => {
    setState("loading");
    setResult(null);
    setSyncError(null);
    try {
      const res = await fetch("/api/admin/radius/sync", { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult({ synced: data.synced, skipped: data.skipped });
      setState("ok");
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  };

  return (
    <div className="flex items-center gap-3 pt-1">
      <Button
        size="sm"
        variant="outline"
        onClick={handleSync}
        disabled={state === "loading"}
        className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${state === "loading" ? "animate-spin" : ""}`} />
        {state === "loading" ? "Syncing…" : "Re-sync RADIUS"}
      </Button>
      {state === "ok" && result && (
        <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Synced {result.synced} · skipped {result.skipped}
        </span>
      )}
      {state === "error" && (
        <span className="flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="w-3.5 h-3.5" /> Sync failed{syncError ? `: ${syncError}` : ""}
        </span>
      )}
      <span className="text-[11px] text-gray-400">Push all active subscriptions into radcheck/radusergroup</span>
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
          <TabsTrigger value="account" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <UserCircle className="w-3.5 h-3.5" /> Account
          </TabsTrigger>
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
          <TabsTrigger value="sms" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <MessageSquare className="w-3.5 h-3.5" /> SMS
          </TabsTrigger>
          <TabsTrigger value="mpesa" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Smartphone className="w-3.5 h-3.5" /> M-Pesa
          </TabsTrigger>
          <TabsTrigger value="infrastructure" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Shield className="w-3.5 h-3.5" /> Infrastructure
          </TabsTrigger>
          <TabsTrigger value="updates" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Updates
          </TabsTrigger>
        </TabsList>

        {/* ── ACCOUNT ─────────────────────────────────────────────────────── */}
        <TabsContent value="account" className="mt-5 space-y-4">
          <ChangePasswordSection />
        </TabsContent>

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
          <SectionCard icon={CreditCard} title="Audit Log Retention">
            <SettingField label="Retention Period (days)" name="auditLogRetentionDays" value={f("auditLogRetentionDays")} onChange={set} type="number" placeholder="365" hint="Audit records older than this are automatically deleted. Set to 0 to disable purging." />
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
            <RadiusResyncButton />
          </SectionCard>
        </TabsContent>

        {/* ── NOTIFICATIONS ────────────────────────────────────────────────── */}
        <TabsContent value="notifications" className="mt-5 space-y-4">
          <SectionCard icon={Bell} title="SMS">
            <div className="py-3 text-sm text-gray-600 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-blue-500 shrink-0" />
              SMS settings have moved to the dedicated <strong>SMS</strong> tab above.
            </div>
          </SectionCard>

          <SectionCard icon={Bell} title="Alert Destinations">
            <SettingField
              label="Slack Webhook URL"
              name="alertSlackWebhook"
              value={f("alertSlackWebhook")}
              onChange={set}
              placeholder="https://hooks.slack.com/services/..."
              hint="Post system alerts (router up/down, etc.) to a Slack channel. Paste the Incoming Webhook URL here."
            />
            <SettingField
              label="Alert Email Address"
              name="alertEmail"
              value={f("alertEmail")}
              onChange={set}
              type="email"
              placeholder="ops@myisp.co.ke"
              hint="Send system alert emails to this address. Uses the SMTP settings configured below."
            />
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
            <div className="py-3">
              <SendTestEmailButton />
              <p className="text-[11px] text-gray-400 mt-1.5">Sends a test message to your account email address using the settings above. Save first if you've made changes.</p>
            </div>
          </SectionCard>

          <SectionCard icon={Bell} title="Scheduled Audit Log Export">
            <ToggleRow
              label="Enable Scheduled Export"
              name="exportScheduleEnabled"
              value={f("exportScheduleEnabled")}
              onChange={set}
              hint="Automatically email an audit log CSV on the chosen schedule. Requires SMTP to be configured above."
            />
            <SelectField
              label="Frequency"
              name="exportScheduleFrequency"
              value={f("exportScheduleFrequency")}
              onChange={set}
              hint="How often to generate and send the export"
              options={[
                { value: "daily",   label: "Daily" },
                { value: "weekly",  label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
            />
            <SettingField
              label="Destination Email"
              name="exportScheduleEmail"
              value={f("exportScheduleEmail")}
              onChange={set}
              type="email"
              placeholder="compliance@myisp.co.ke"
              hint="The CSV will be sent as an attachment to this address"
            />
            {f("exportScheduleLastSentAt") && (
              <div className="py-3 text-xs text-gray-400">
                Last sent: {new Date(f("exportScheduleLastSentAt")).toLocaleString()}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* ── SMS ─────────────────────────────────────────────────────────── */}
        <TabsContent value="sms" className="mt-5 space-y-4">
          <SmsTab f={f} set={set} />
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

          <RegisterUrlsCard />

          <SectionCard icon={Shield} title="M-Pesa Security">
            <SettingField
              label="Webhook Secret"
              name="mpesaWebhookSecret"
              value={f("mpesaWebhookSecret")}
              onChange={set}
              secret
              placeholder="Shared secret sent in X-Mpesa-Webhook-Secret header"
              hint="Safaricom must include this value in the X-Mpesa-Webhook-Secret header on every callback. Leave blank to skip this check. Overrides the MPESA_WEBHOOK_SECRET env var — no redeploy needed to rotate."
            />
            <div className="grid grid-cols-12 gap-3 items-start py-3 border-b border-gray-100">
              <div className="col-span-4">
                <Label className="text-sm font-medium text-gray-700">Allowed IP Ranges</Label>
                <p className="text-xs text-gray-400 mt-0.5">
                  One CIDR or IP per line (or comma-separated). Leave blank to use Safaricom's
                  published defaults. Set to <code className="bg-gray-100 px-1 rounded">*</code> to
                  disable IP checking (sandbox only).
                </p>
              </div>
              <div className="col-span-8">
                <Textarea
                  rows={6}
                  placeholder={"196.201.214.0/24\n196.201.216.0/24\n196.201.213.0/24"}
                  value={(f("mpesaAllowedIps") ?? "").replace(/,/g, "\n")}
                  onChange={(e) =>
                    set(
                      "mpesaAllowedIps",
                      e.target.value
                        .split(/[\n,]+/)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        .join(",")
                    )
                  }
                  className="text-sm font-mono resize-none"
                />
                <EffectiveAllowlist />
              </div>
            </div>
            <div className="py-2 text-xs text-gray-400">
              Changes take effect on the next callback — no server restart required.
            </div>
          </SectionCard>

          <SectionCard icon={Smartphone} title="M-Pesa Status">
            <div className="py-3">
              <MpesaStatus />
            </div>
          </SectionCard>
        </TabsContent>
        {/* ── INFRASTRUCTURE ──────────────────────────────────────────────── */}
        <TabsContent value="infrastructure" className="mt-5">
          <InfrastructureTab f={f} set={set} />
        </TabsContent>

        <TabsContent value="updates" className="mt-5">
          <UpdatesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Provider metadata ────────────────────────────────────────────────────────
const SMS_PROVIDERS = [
  { value: "disabled",        label: "Disabled" },
  { value: "africas_talking", label: "Africa's Talking" },
  { value: "movesms",         label: "MoveSMS" },
  { value: "zettatel",        label: "Zettatel" },
  { value: "celcom_africa",   label: "Celcom Africa" },
  { value: "hostpinnacle",    label: "HostPinnacle" },
  { value: "mobilesasa",      label: "MobileSasa" },
  { value: "onfonmedia",      label: "OnfonMedia" },
  { value: "beem_africa",     label: "Beem Africa" },
  { value: "advanta_africa",  label: "Advanta Africa" },
];

const PROVIDER_LINKS: Record<string, string> = {
  africas_talking: "https://africastalking.com",
  movesms:         "https://movesms.co.ke",
  zettatel:        "https://portal.zettatel.com",
  celcom_africa:   "https://celcomafrica.com",
  hostpinnacle:    "https://sms.hostpinnacle.co.ke",
  mobilesasa:      "https://mobilesasa.com",
  onfonmedia:      "https://onfonmedia.co.ke",
  beem_africa:     "https://beem.africa",
  advanta_africa:  "https://quicksms.advantasms.com",
};

// Which fields each provider needs
const PROVIDER_FIELDS: Record<string, {
  apiKey?: string; apiSecret?: string; username?: string;
  partnerId?: string; clientId?: string; environment?: boolean;
}> = {
  africas_talking: { apiKey: "API Key",  username: "AT Username", environment: true },
  movesms:         { apiKey: "API Key",  partnerId: "Partner ID" },
  zettatel:        { apiKey: "Password", username: "User ID" },
  celcom_africa:   { apiKey: "API Key",  partnerId: "Partner ID" },
  hostpinnacle:    { apiKey: "API Key",  partnerId: "Partner ID" },
  mobilesasa:      { apiKey: "API Token" },
  onfonmedia:      { apiKey: "API Key",  partnerId: "Partner ID", clientId: "Client ID" },
  beem_africa:     { apiKey: "API Key",  apiSecret: "Secret Key" },
  advanta_africa:  { apiKey: "API Key",  partnerId: "Partner ID" },
};

function ToggleRow({ label, name, value, onChange, hint }: {
  label: string; name: string; value: string;
  onChange: (n: string, v: string) => void; hint?: string;
}) {
  const on = value === "1" || value === "true";
  return (
    <div className="grid grid-cols-12 gap-3 items-center py-3 border-b border-gray-100 last:border-0">
      <div className="col-span-8">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="col-span-4 flex justify-end">
        <Switch checked={on} onCheckedChange={(v) => onChange(name, v ? "1" : "0")} />
      </div>
    </div>
  );
}

function SmsTab({ f, set }: { f: (k: string) => string; set: (k: string, v: string) => void }) {
  const provider = f("smsProvider");
  const active   = provider && provider !== "disabled";
  const fields   = active ? PROVIDER_FIELDS[provider] : undefined;
  const link     = active ? PROVIDER_LINKS[provider] : undefined;

  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTest = async () => {
    if (!testPhone) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testPhone }),
      });
      const data = await res.json() as { success: boolean; message: string };
      setTestResult(data);
    } catch {
      setTestResult({ success: false, message: "Request failed — is the server running?" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Provider selector */}
      <SectionCard icon={MessageSquare} title="SMS Provider">
        <SelectField
          label="Provider"
          name="smsProvider"
          value={f("smsProvider")}
          onChange={set}
          hint="All providers support Kenyan networks (Safaricom, Airtel, Telkom)"
          options={SMS_PROVIDERS}
        />
        <SettingField
          label="Sender ID"
          name="smsSenderId"
          value={f("smsSenderId")}
          onChange={set}
          placeholder="NetPulse"
          hint="Alphanumeric name shown on recipient's phone (max 11 chars). Must be pre-registered."
        />
        {link && (
          <div className="py-2.5 border-b border-gray-100">
            <a href={link} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 underline">
              <Send className="w-3.5 h-3.5" /> Sign up / get credentials at {link}
            </a>
          </div>
        )}
      </SectionCard>

      {/* Provider-specific credentials */}
      {fields && (
        <SectionCard icon={MessageSquare} title="Credentials">
          {fields.username && (
            <SettingField
              label={fields.username}
              name="smsUsername"
              value={f("smsUsername")}
              onChange={set}
              placeholder={provider === "africas_talking" ? "sandbox" : "your-username"}
              hint={provider === "africas_talking" ? "Use 'sandbox' for testing" : undefined}
            />
          )}
          {fields.apiKey && (
            <SettingField label={fields.apiKey} name="smsApiKey" value={f("smsApiKey")} onChange={set} secret placeholder="Your API key" />
          )}
          {fields.apiSecret && (
            <SettingField label={fields.apiSecret} name="smsApiSecret" value={f("smsApiSecret")} onChange={set} secret placeholder="Your secret key" />
          )}
          {fields.partnerId && (
            <SettingField label="Partner ID" name="smsPartnerId" value={f("smsPartnerId")} onChange={set} placeholder="Your partner ID" />
          )}
          {fields.clientId && (
            <SettingField label="Client ID" name="smsClientId" value={f("smsClientId")} onChange={set} placeholder="Your client ID" />
          )}
          {fields.environment && (
            <SelectField
              label="Environment"
              name="smsEnvironment"
              value={f("smsEnvironment") || "sandbox"}
              onChange={set}
              hint="Use Sandbox for testing — no real SMS is sent"
              options={[
                { value: "sandbox",    label: "Sandbox (Testing)" },
                { value: "production", label: "Production (Live)" },
              ]}
            />
          )}
        </SectionCard>
      )}

      {/* M-Pesa Paybill for SMS templates */}
      {active && (
        <SectionCard icon={Bell} title="M-Pesa Payment Details">
          <SettingField
            label="Paybill Number"
            name="mpesaPaybillNumber"
            value={f("mpesaPaybillNumber")}
            onChange={set}
            placeholder="e.g. 522522"
            hint="Shown in expiry reminder SMS as the payment Paybill. Used by the {paybill} variable in SMS templates."
          />
        </SectionCard>
      )}

      {/* Notification event toggles */}
      {active && (
        <SectionCard icon={Bell} title="Automatic Notifications">
          <ToggleRow label="Invoice Created"     name="smsNotifyInvoice" value={f("smsNotifyInvoice")} onChange={set} hint="Send SMS when a new invoice is generated" />
          <ToggleRow label="Payment Received"    name="smsNotifyPayment" value={f("smsNotifyPayment")} onChange={set} hint="Confirm received payments with amount and reference" />
          <ToggleRow label="Subscription Expiring" name="smsNotifyExpiry" value={f("smsNotifyExpiry")} onChange={set} hint="Warn customers before their plan expires" />
          <div className="grid grid-cols-12 gap-3 items-center py-2 border-b border-gray-100">
            <div className="col-span-8" />
            <div className="col-span-4">
              <Input
                type="number"
                min={1}
                max={30}
                value={f("smsExpiryNotifyDays") || "3"}
                onChange={(e) => set("smsExpiryNotifyDays", e.target.value)}
                className="text-sm h-8"
                placeholder="3"
              />
              <p className="text-xs text-gray-400 mt-0.5 text-right">days before</p>
            </div>
          </div>
          <ToggleRow label="Ticket Status Changed" name="smsNotifyTicket"  value={f("smsNotifyTicket")}  onChange={set} hint="Notify when a support ticket is updated or resolved" />
          <ToggleRow label="New Account Welcome"   name="smsNotifyWelcome" value={f("smsNotifyWelcome")} onChange={set} hint="Send welcome SMS when a customer account is created" />
        </SectionCard>
      )}

      {/* Router alert phone */}
      {active && (
        <SectionCard icon={Bell} title="Router Alert Notifications">
          <SettingField
            label="Alert Phone Number"
            name="alertPhone"
            value={f("alertPhone")}
            onChange={set}
            placeholder="07XXXXXXXX or +254XXXXXXXXX"
            hint="SMS alerts for router going DOWN or coming back ONLINE are sent to this number. Leave blank to disable router alerts."
          />
          <div className="py-2.5 border-b border-gray-100 last:border-0">
            <p className="text-xs text-gray-500">
              The system checks each router every <strong>3 minutes</strong>. A state change is confirmed after
              2 consecutive checks to avoid false positives. Messages sent:
            </p>
            <ul className="text-xs text-gray-500 list-disc list-inside mt-1 space-y-0.5">
              <li><strong>OFFLINE:</strong> [NetPulse ALERT] Router "Name" (IP) is OFFLINE. Detected at …</li>
              <li><strong>ONLINE:</strong> [NetPulse OK] Router "Name" (IP) is back ONLINE. Recovered at …</li>
            </ul>
          </div>
        </SectionCard>
      )}

      {/* Test SMS */}
      {active && (
        <SectionCard icon={Send} title="Test SMS">
          <div className="py-4 space-y-3">
            <p className="text-sm text-gray-500">
              Save your settings first, then send a test SMS to confirm everything is working.
            </p>
            <div className="flex gap-2">
              <Input
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="07XXXXXXXX or +254XXXXXXXXX"
                className="text-sm max-w-xs"
              />
              <Button
                onClick={handleTest}
                disabled={testing || !testPhone}
                className="bg-blue-600 hover:bg-blue-700 text-white gap-2 shrink-0"
                size="sm"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {testing ? "Sending…" : "Send Test SMS"}
              </Button>
            </div>
            {testResult && (
              <div className={`flex items-start gap-2 text-sm px-3 py-2.5 rounded-lg border ${
                testResult.success
                  ? "bg-green-50 border-green-200 text-green-700"
                  : "bg-red-50 border-red-200 text-red-700"
              }`}>
                {testResult.success
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function RegisterUrlsCard() {
  const origin = window.location.origin;
  const confirmationUrl = `${origin}/api/mpesa/c2b/confirmation`;
  const validationUrl = `${origin}/api/mpesa/c2b/validation`;

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleRegister() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/mpesa/register-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmationUrl, validationUrl }),
        credentials: "include",
      });
      const data = (await res.json()) as { success?: boolean; error?: string; detail?: Record<string, unknown> };
      if (res.ok && data.success) {
        const desc = (data.detail?.["ResponseDescription"] as string | undefined) ?? "URLs registered successfully";
        setResult({ ok: true, message: desc });
      } else {
        const detail = data.detail
          ? ` — ${(data.detail["ResponseDescription"] as string | undefined) ?? JSON.stringify(data.detail)}`
          : "";
        setResult({ ok: false, message: (data.error ?? "Registration failed") + detail });
      }
    } catch {
      setResult({ ok: false, message: "Network error — could not reach the server." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard icon={Link2} title="Register C2B URLs with Safaricom">
      <div className="py-2 space-y-4 text-sm">
        <p className="text-gray-500 text-xs">
          After saving your credentials above, click <strong>Register URLs</strong> to tell Safaricom where to send
          C2B payment notifications for your shortcode. This only needs to be done once (or after your domain changes).
        </p>

        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-3 items-center py-2 border-b border-gray-100">
            <span className="col-span-4 font-medium text-gray-700">Confirmation URL</span>
            <code className="col-span-8 bg-gray-50 text-blue-700 px-3 py-1.5 rounded text-xs font-mono select-all border border-gray-200 truncate">
              {confirmationUrl}
            </code>
          </div>
          <div className="grid grid-cols-12 gap-3 items-center py-2">
            <span className="col-span-4 font-medium text-gray-700">Validation URL</span>
            <code className="col-span-8 bg-gray-50 text-blue-700 px-3 py-1.5 rounded text-xs font-mono select-all border border-gray-200 truncate">
              {validationUrl}
            </code>
          </div>
        </div>

        {result && (
          <div className={`flex items-start gap-2 rounded-md px-4 py-2.5 text-sm border ${
            result.ok
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-red-50 text-red-700 border-red-200"
          }`}>
            {result.ok
              ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            onClick={handleRegister}
            disabled={loading}
            size="sm"
            className="gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            {loading ? "Registering…" : "Register URLs with Safaricom"}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function EffectiveAllowlist() {
  const { data, isLoading, isError } = useGetMpesaIpAllowlist();

  const SOURCE_LABELS: Record<string, string> = {
    db:      "DB setting",
    env:     "env var (MPESA_ALLOWED_IPS)",
    default: "Safaricom defaults",
  };

  const SOURCE_COLORS: Record<string, string> = {
    db:      "bg-blue-50 border-blue-200 text-blue-800",
    env:     "bg-purple-50 border-purple-200 text-purple-800",
    default: "bg-gray-50 border-gray-200 text-gray-600",
  };

  if (isLoading) {
    return <Skeleton className="h-16 w-full mt-2" />;
  }

  if (isError || !data) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Could not load effective ranges
      </div>
    );
  }

  const sourceLabel = SOURCE_LABELS[data.source] ?? data.source;
  const colorClass  = SOURCE_COLORS[data.source] ?? SOURCE_COLORS["default"]!;
  const isBypass    = data.cidrs.length === 1 && data.cidrs[0] === "*";

  return (
    <div className={`mt-3 rounded-md border px-3 py-2.5 ${colorClass}`}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Effective ranges
        </p>
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colorClass} border`}>
          source: {sourceLabel}
        </Badge>
      </div>
      {isBypass ? (
        <p className="text-sm font-mono font-medium">
          * — IP checking disabled (all IPs allowed)
        </p>
      ) : (
        <ul className="space-y-0.5">
          {data.cidrs.map((cidr) => (
            <li key={cidr} className="text-xs font-mono">{cidr}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MpesaStatus() {
  const [status, setStatus] = useState<{
    configured: boolean;
    environment: string;
    shortcode: string | null;
    webhookSecretConfigured: boolean;
  } | null>(null);

  useEffect(() => {
    fetch("/api/mpesa/status", { credentials: "include" })
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => null);
  }, []);

  if (!status) return <Skeleton className="h-8 w-48" />;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-3">
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
      <div className="flex items-center gap-3">
        <Badge
          className={status.webhookSecretConfigured
            ? "bg-green-100 text-green-700 border-green-200"
            : "bg-gray-100 text-gray-500 border-gray-200"}
          variant="outline"
        >
          Webhook secret: {status.webhookSecretConfigured ? "set" : "not set"}
        </Badge>
        {!status.webhookSecretConfigured && (
          <span className="text-xs text-gray-400">Set a webhook secret above for extra callback security.</span>
        )}
      </div>
    </div>
  );
}
