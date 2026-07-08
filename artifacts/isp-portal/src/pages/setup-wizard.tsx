import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { signIn } from "@/lib/authClient";
import {
  Building2, Globe, CreditCard, Rocket, Check, UserCog,
  ArrowLeft, ArrowRight, Loader2, Wifi, Clock, DollarSign,
  Phone, Mail, MapPin, FileText, AlertCircle, Eye, EyeOff, Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STEPS = [
  { id: "welcome",  label: "Welcome",      icon: Rocket },
  { id: "admin",    label: "Admin Account", icon: UserCog },
  { id: "company",  label: "Company",      icon: Building2 },
  { id: "region",   label: "Region",       icon: Globe },
  { id: "billing",  label: "Billing",      icon: CreditCard },
  { id: "done",     label: "Launch!",      icon: Rocket },
];

type FormData = {
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  adminPasswordConfirm: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  timezone: string;
  currency: string;
  invoicePrefix: string;
  invoiceDueDays: string;
  lateFeePercent: string;
  autoSuspendDays: string;
  gracePeriodDays: string;
  ntpServer: string;
};

const DEFAULTS: FormData = {
  adminName: "", adminEmail: "", adminPassword: "", adminPasswordConfirm: "",
  companyName: "", companyAddress: "", companyPhone: "", companyEmail: "",
  timezone: "Africa/Nairobi", currency: "KES",
  invoicePrefix: "INV-", invoiceDueDays: "14",
  lateFeePercent: "5", autoSuspendDays: "3", gracePeriodDays: "1",
  ntpServer: "time.cloudflare.com",
};

function Field({ label, hint, icon: Icon, children }: {
  label: string; hint?: string; icon?: React.ElementType; children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
        {Icon && <Icon className="w-3.5 h-3.5 text-blue-500" />}
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

export default function SetupWizard() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{ complete: boolean; version: string } | null>(null);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((d: { complete: boolean; version: string }) => {
        setSystemInfo(d);
        if (d.complete) setLocation("/");
      })
      .catch(() => {});
  }, [setLocation]);

  const set = (k: keyof FormData, v: string) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const next = () => { setError(""); setStep((s) => Math.min(s + 1, STEPS.length - 1)); };
  const back = () => { setError(""); setStep((s) => Math.max(s - 1, 0)); };

  // Per-step validation before advancing
  const canAdvance = () => {
    if (step === 1) {
      if (!form.adminName || !form.adminEmail || !form.adminPassword) return false;
      if (form.adminPassword.length < 8) return false;
      if (form.adminPassword !== form.adminPasswordConfirm) return false;
    }
    if (step === 2) {
      if (!form.companyName) return false;
    }
    return true;
  };

  const handleFinish = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/setup/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Save failed");

      // Auto-sign-in with the new admin credentials
      const signInRes = await signIn.email({
        email: form.adminEmail,
        password: form.adminPassword,
      });
      if (signInRes.error) {
        // Account was created — just redirect to sign-in
        window.location.href = "/sign-in";
        return;
      }

      setStep(5); // done
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const isLastStep = step === 4;
  const isDone = step === 5;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex" style={{ minHeight: 560 }}>

        {/* Sidebar */}
        <div className="w-56 bg-slate-900 flex flex-col py-8 px-5 shrink-0">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <Wifi className="w-4 h-4 text-white" />
            </div>
            <span className="text-white font-bold text-sm">NetPulse</span>
          </div>

          <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold mb-4">Setup</p>

          <nav className="space-y-1 flex-1">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              const Icon = s.icon;
              return (
                <div key={s.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                  active ? "bg-blue-600 text-white font-medium" : done ? "text-slate-300" : "text-slate-500"
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                    done ? "bg-green-500" : active ? "bg-blue-500" : "bg-slate-700"
                  }`}>
                    {done ? <Check className="w-3 h-3 text-white" /> : <Icon className="w-3 h-3" />}
                  </div>
                  {s.label}
                </div>
              );
            })}
          </nav>
          <div className="text-slate-600 text-xs mt-4">Step {step + 1} of {STEPS.length}</div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          <div className="h-1 bg-gray-100">
            <div className="h-full bg-blue-600 transition-all duration-500"
              style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
          </div>

          <div className="flex-1 p-8 overflow-y-auto">

            {/* STEP 0: Welcome */}
            {step === 0 && (
              <div className="max-w-lg">
                <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-xs font-medium mb-4">
                  <Rocket className="w-3.5 h-3.5" /> First-time setup
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-3">Welcome to NetPulse</h1>
                <p className="text-gray-500 text-base leading-relaxed mb-6">
                  Let's get your ISP management system ready. This takes about
                  <strong className="text-gray-700"> 2 minutes</strong> and covers everything you need to get started.
                </p>
                <div className="grid grid-cols-2 gap-3 mb-8">
                  {[
                    { icon: UserCog,    label: "Create admin account" },
                    { icon: Building2,  label: "Company profile" },
                    { icon: Globe,      label: "Timezone & currency" },
                    { icon: CreditCard, label: "Billing defaults" },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-2.5 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
                      <Icon className="w-4 h-4 text-blue-500 shrink-0" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </div>
                  ))}
                </div>
                {systemInfo && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    Server running · NetPulse v{systemInfo.version} · No external accounts needed
                  </div>
                )}
              </div>
            )}

            {/* STEP 1: Admin Account */}
            {step === 1 && (
              <div className="max-w-lg">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Create Admin Account</h2>
                <p className="text-gray-400 text-sm mb-6">
                  This is the first administrator account. You'll use these credentials to sign in.
                  No external service required — stored securely in your own database.
                </p>
                <div className="space-y-4">
                  <Field label="Your Name" icon={UserCog}>
                    <Input
                      value={form.adminName}
                      onChange={(e) => set("adminName", e.target.value)}
                      placeholder="John Doe"
                      autoFocus
                    />
                  </Field>
                  <Field label="Email Address" icon={Mail}>
                    <Input
                      type="email"
                      value={form.adminEmail}
                      onChange={(e) => set("adminEmail", e.target.value)}
                      placeholder="admin@myisp.co.ke"
                    />
                  </Field>
                  <Field label="Password" icon={Lock} hint="Minimum 8 characters">
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={form.adminPassword}
                        onChange={(e) => set("adminPassword", e.target.value)}
                        placeholder="••••••••"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setShowPassword((s) => !s)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {form.adminPassword && form.adminPassword.length < 8 && (
                      <p className="text-xs text-red-500 mt-1">Password must be at least 8 characters</p>
                    )}
                  </Field>
                  <Field label="Confirm Password" icon={Lock}>
                    <Input
                      type="password"
                      value={form.adminPasswordConfirm}
                      onChange={(e) => set("adminPasswordConfirm", e.target.value)}
                      placeholder="••••••••"
                    />
                    {form.adminPasswordConfirm && form.adminPassword !== form.adminPasswordConfirm && (
                      <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                    )}
                  </Field>
                </div>
              </div>
            )}

            {/* STEP 2: Company */}
            {step === 2 && (
              <div className="max-w-lg">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Company Information</h2>
                <p className="text-gray-400 text-sm mb-6">Appears on invoices, reports, and customer communications.</p>
                <div className="space-y-4">
                  <Field label="Company Name" icon={Building2}>
                    <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)}
                      placeholder="Acme Internet Ltd" autoFocus />
                  </Field>
                  <Field label="Address" icon={MapPin}>
                    <Input value={form.companyAddress} onChange={(e) => set("companyAddress", e.target.value)}
                      placeholder="123 Main St, Nairobi" />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Phone" icon={Phone}>
                      <Input value={form.companyPhone} onChange={(e) => set("companyPhone", e.target.value)}
                        placeholder="+254 700 000 000" />
                    </Field>
                    <Field label="Email" icon={Mail}>
                      <Input type="email" value={form.companyEmail} onChange={(e) => set("companyEmail", e.target.value)}
                        placeholder="support@myisp.co.ke" />
                    </Field>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Region */}
            {step === 3 && (
              <div className="max-w-lg">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Region & Defaults</h2>
                <p className="text-gray-400 text-sm mb-6">Set your timezone and local currency for accurate billing.</p>
                <div className="space-y-4">
                  <Field label="Timezone" icon={Clock} hint="Used for scheduling, billing cycles, and timestamps">
                    <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Africa/Nairobi">Africa/Nairobi (EAT +3)</SelectItem>
                        <SelectItem value="Africa/Kampala">Africa/Kampala (EAT +3)</SelectItem>
                        <SelectItem value="Africa/Dar_es_Salaam">Africa/Dar es Salaam (EAT +3)</SelectItem>
                        <SelectItem value="Africa/Lagos">Africa/Lagos (WAT +1)</SelectItem>
                        <SelectItem value="Africa/Johannesburg">Africa/Johannesburg (SAST +2)</SelectItem>
                        <SelectItem value="Africa/Accra">Africa/Accra (GMT +0)</SelectItem>
                        <SelectItem value="Africa/Cairo">Africa/Cairo (EET +2)</SelectItem>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="America/New_York">America/New_York (EST/EDT)</SelectItem>
                        <SelectItem value="Europe/London">Europe/London (GMT/BST)</SelectItem>
                        <SelectItem value="Asia/Dubai">Asia/Dubai (GST +4)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Currency" icon={DollarSign} hint="Used on all invoices and financial reports">
                    <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KES">KES — Kenyan Shilling</SelectItem>
                        <SelectItem value="UGX">UGX — Ugandan Shilling</SelectItem>
                        <SelectItem value="TZS">TZS — Tanzanian Shilling</SelectItem>
                        <SelectItem value="USD">USD — US Dollar</SelectItem>
                        <SelectItem value="NGN">NGN — Nigerian Naira</SelectItem>
                        <SelectItem value="GHS">GHS — Ghanaian Cedi</SelectItem>
                        <SelectItem value="ZAR">ZAR — South African Rand</SelectItem>
                        <SelectItem value="EUR">EUR — Euro</SelectItem>
                        <SelectItem value="GBP">GBP — British Pound</SelectItem>
                        <SelectItem value="AED">AED — UAE Dirham</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="NTP Server" icon={Clock} hint="Routers sync time to this server">
                    <Input value={form.ntpServer} onChange={(e) => set("ntpServer", e.target.value)}
                      placeholder="time.cloudflare.com" />
                  </Field>
                </div>
              </div>
            )}

            {/* STEP 4: Billing */}
            {step === 4 && (
              <div className="max-w-lg">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Billing Defaults</h2>
                <p className="text-gray-400 text-sm mb-6">Apply to all invoices. Override per-customer later.</p>
                <div className="space-y-4">
                  <Field label="Invoice Prefix" icon={FileText} hint="Prepended to invoice numbers (e.g. INV-0001)">
                    <Input value={form.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value)}
                      placeholder="INV-" />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Payment Due (days)" hint="Days before overdue">
                      <Input type="number" min="1" value={form.invoiceDueDays}
                        onChange={(e) => set("invoiceDueDays", e.target.value)} placeholder="14" />
                    </Field>
                    <Field label="Late Fee (%)" hint="Added to overdue invoices">
                      <Input type="number" min="0" value={form.lateFeePercent}
                        onChange={(e) => set("lateFeePercent", e.target.value)} placeholder="5" />
                    </Field>
                    <Field label="Auto-Suspend (days)" hint="Days after due date">
                      <Input type="number" min="0" value={form.autoSuspendDays}
                        onChange={(e) => set("autoSuspendDays", e.target.value)} placeholder="3" />
                    </Field>
                    <Field label="Grace Period (days)" hint="Before suspension">
                      <Input type="number" min="0" value={form.gracePeriodDays}
                        onChange={(e) => set("gracePeriodDays", e.target.value)} placeholder="1" />
                    </Field>
                  </div>
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">
                    <AlertCircle className="w-4 h-4 shrink-0" />{error}
                  </div>
                )}
              </div>
            )}

            {/* STEP 5: Done */}
            {isDone && (
              <div className="max-w-lg text-center py-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                  <Check className="w-8 h-8 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">You're all set!</h2>
                <p className="text-gray-500 text-sm mb-2">
                  NetPulse is configured and you're signed in as <strong>{form.adminEmail}</strong>.
                </p>
                <p className="text-gray-400 text-xs mb-8">No Clerk account. No external services. Fully self-hosted.</p>
                <div className="grid grid-cols-2 gap-3 mb-8 text-left">
                  {[
                    { label: "Add customers",  hint: "Import or create subscriber accounts", href: "/customers" },
                    { label: "Create plans",   hint: "Set up your service tiers & pricing",  href: "/plans" },
                    { label: "Add routers",    hint: "Connect your MikroTik devices",         href: "/network" },
                    { label: "All settings",   hint: "Configure SMS, M-Pesa, RADIUS & VPN",  href: "/settings" },
                  ].map(({ label, hint, href }) => (
                    <a key={href} href={href}
                      className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg px-4 py-3 transition-colors">
                      <p className="text-sm font-medium text-gray-800">{label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
                    </a>
                  ))}
                </div>
                <Button onClick={() => setLocation("/")}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-2.5 text-sm font-semibold gap-2">
                  <Rocket className="w-4 h-4" /> Go to Dashboard
                </Button>
              </div>
            )}
          </div>

          {/* Footer nav */}
          {!isDone && (
            <div className="px-8 py-5 border-t border-gray-100 flex justify-between items-center bg-gray-50/50">
              <Button variant="ghost" onClick={back} disabled={step === 0} className="gap-2 text-gray-500">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
              <div className="flex gap-1.5">
                {STEPS.slice(0, -1).map((_, i) => (
                  <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${
                    i === step ? "bg-blue-600 w-4" : i < step ? "bg-green-500" : "bg-gray-200"
                  }`} />
                ))}
              </div>
              {isLastStep ? (
                <Button onClick={handleFinish} disabled={saving || !form.companyName}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2 px-6">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                  {saving ? "Saving…" : "Launch NetPulse"}
                </Button>
              ) : (
                <Button onClick={next} disabled={!canAdvance()}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                  {step === 0 ? "Get Started" : "Continue"} <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
