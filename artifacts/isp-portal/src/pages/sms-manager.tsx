import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  MessageSquare, Plus, Pencil, Trash2, Send, Clock, CheckCircle,
  XCircle, Eye, ChevronDown, ChevronUp, Info,
} from "lucide-react";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ──────────────────────────────────────────────────────────────────────

interface SmsTemplate {
  id: number;
  name: string;
  triggerType: string;
  message: string;
  isActive: boolean;
  createdAt: string;
}

interface SmsLog {
  id: number;
  customerId: number | null;
  customerName: string | null;
  phone: string;
  message: string;
  triggerType: string;
  status: "sent" | "failed";
  error: string | null;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  manual:     "Manual / Bulk",
  reminder_6: "6 Days Before Expiry",
  reminder_5: "5 Days Before Expiry",
  reminder_4: "4 Days Before Expiry",
  reminder_3: "3 Days Before Expiry",
  reminder_2: "2 Days Before Expiry",
  reminder_1: "1 Day Before Expiry",
  reminder_0: "On Expiry Day",
};

const TRIGGER_OPTIONS = Object.entries(TRIGGER_LABELS);

const VARIABLE_CHIPS = [
  { tag: "{name}",        label: "Customer Name" },
  { tag: "{username}",    label: "PPPoE Username" },
  { tag: "{account}",     label: "Account No. (PPPoE)" },
  { tag: "{plan}",        label: "Package Name" },
  { tag: "{amount}",      label: "Package Amount" },
  { tag: "{paybill}",     label: "M-Pesa Paybill" },
  { tag: "{days_left}",   label: "Days Left" },
  { tag: "{expiry_date}", label: "Expiry Date" },
  { tag: "{phone}",       label: "Phone Number" },
];

function triggerBadge(t: string) {
  if (t === "manual") return <Badge variant="secondary">Bulk / Manual</Badge>;
  if (t === "reminder_0") return <Badge className="bg-red-500 text-white">Expiry Day</Badge>;
  if (t === "reminder_1") return <Badge className="bg-orange-500 text-white">1 Day</Badge>;
  if (t.startsWith("reminder_")) {
    const n = t.split("_")[1];
    return <Badge className="bg-blue-500 text-white">{n} Days</Badge>;
  }
  return <Badge variant="outline">{t}</Badge>;
}

// ── Template Form Dialog ───────────────────────────────────────────────────────

interface TemplateFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<SmsTemplate>;
}

function TemplateFormDialog({ open, onClose, initial }: TemplateFormProps) {
  const qc = useQueryClient();
  const isEdit = !!initial?.id;

  const [name,        setName]        = useState(initial?.name        ?? "");
  const [triggerType, setTriggerType] = useState(initial?.triggerType ?? "manual");
  const [message,     setMessage]     = useState(initial?.message     ?? "");
  const [isActive,    setIsActive]    = useState(initial?.isActive    ?? true);
  const [preview,     setPreview]     = useState("");
  const [previewErr,  setPreviewErr]  = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const url   = isEdit ? `${API}/api/sms/templates/${initial!.id}` : `${API}/api/sms/templates`;
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, triggerType, message, isActive }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["sms-templates"] }); onClose(); },
  });

  const doPreview = async () => {
    setPreviewErr("");
    try {
      const r = await fetch(`${API}/api/sms/preview`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const d = await r.json();
      setPreview(d.preview ?? "");
    } catch {
      setPreviewErr("Preview failed");
    }
  };

  const insertTag = (tag: string) => setMessage(m => m + tag);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Template" : "New SMS Template"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Template Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 3-Day Expiry Reminder" />
            </div>
            <div className="space-y-1.5">
              <Label>Trigger</Label>
              <Select value={triggerType} onValueChange={setTriggerType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGER_OPTIONS.map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Variable chips */}
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-500">Insert Variable</Label>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLE_CHIPS.map(c => (
                <button key={c.tag} type="button" onClick={() => insertTag(c.tag)}
                  className="text-xs px-2 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 font-mono">
                  {c.tag}
                  <span className="font-sans text-blue-500 ml-1 not-italic">({c.label})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Type your SMS message. Click variables above to insert them."
              rows={5}
              className="font-mono text-sm"
            />
            <p className="text-xs text-gray-500">{message.length} characters · ~{Math.ceil(message.length / 160)} SMS credit(s)</p>
          </div>

          {/* Live preview */}
          {preview && (
            <div className="rounded-md bg-green-50 border border-green-200 p-3">
              <p className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1"><Eye className="w-3 h-3" /> Preview (sample data)</p>
              <p className="text-sm text-green-900 whitespace-pre-wrap">{preview}</p>
            </div>
          )}
          {previewErr && <p className="text-xs text-red-500">{previewErr}</p>}

          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="sm" onClick={doPreview}>
              <Eye className="w-4 h-4 mr-1" /> Preview Message
            </Button>
            <div className="flex items-center gap-2 ml-auto">
              <Label className="text-sm">Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>

          {triggerType !== "manual" && (
            <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>This template will be sent automatically by the server every day to active subscribers whose subscription ends in <strong>{TRIGGER_LABELS[triggerType]?.replace(" Before Expiry","")?.replace(" Day Before Expiry"," day")?.replace(" Days Before Expiry"," days")}</strong>. Only <strong>one reminder per subscription per day</strong> is ever sent.</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name || !message || save.isPending}>
            {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Send Dialog ───────────────────────────────────────────────────────────

function BulkSendDialog({ open, onClose, templates }: { open: boolean; onClose: () => void; templates: SmsTemplate[] }) {
  const [templateId,  setTemplateId]  = useState<string>("__none__");
  const [customMsg,   setCustomMsg]   = useState("");
  const [filter,      setFilter]      = useState("all");
  const [result,      setResult]      = useState<{ sent: number; failed: number; total: number; errors: string[] } | null>(null);
  const [sending,     setSending]     = useState(false);
  const [errMsg,      setErrMsg]      = useState("");

  const selectedTemplate = templates.find(t => String(t.id) === templateId);
  const activeMessage = selectedTemplate?.message ?? customMsg;

  const send = async () => {
    setSending(true); setErrMsg(""); setResult(null);
    try {
      const body: Record<string, unknown> = { filter };
      if (templateId !== "__none__") body.templateId = parseInt(templateId);
      else body.message = customMsg;
      const r = await fetch(`${API}/api/sms/bulk`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setErrMsg(d.error ?? "Send failed"); }
      else setResult(d);
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Send Bulk SMS</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Recipients</Label>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers (with phone)</SelectItem>
                <SelectItem value="active">Active Subscribers Only</SelectItem>
                <SelectItem value="suspended">Suspended Subscribers</SelectItem>
                <SelectItem value="expiring_7">Expiring in Next 7 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Message Template</Label>
            <Select value={templateId} onValueChange={v => { setTemplateId(v); setCustomMsg(""); }}>
              <SelectTrigger><SelectValue placeholder="Choose a template…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Custom message —</SelectItem>
                {templates.map(t => (
                  <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templateId === "__none__" ? (
            <div className="space-y-1.5">
              <Label>Custom Message</Label>
              <Textarea value={customMsg} onChange={e => setCustomMsg(e.target.value)} rows={4} placeholder="Type message…" className="font-mono text-sm" />
              <div className="flex flex-wrap gap-1 mt-1">
                {VARIABLE_CHIPS.map(c => (
                  <button key={c.tag} type="button" onClick={() => setCustomMsg(m => m + c.tag)}
                    className="text-xs px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 font-mono">
                    {c.tag}
                  </button>
                ))}
              </div>
            </div>
          ) : activeMessage ? (
            <div className="rounded-md bg-gray-50 border p-3 text-sm text-gray-700 whitespace-pre-wrap font-mono">{activeMessage}</div>
          ) : null}

          {errMsg && <p className="text-sm text-red-500">{errMsg}</p>}

          {result && (
            <div className={`rounded-md border p-3 text-sm space-y-1 ${result.failed === 0 ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"}`}>
              <p className="font-semibold">
                {result.sent} sent · {result.failed} failed · {result.total} total recipients
              </p>
              {result.errors.length > 0 && (
                <ul className="text-xs text-red-600 list-disc list-inside">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={send} disabled={sending || (!activeMessage)} className="gap-2">
            <Send className="w-4 h-4" />
            {sending ? "Sending…" : "Send SMS"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SmsManager() {
  const qc = useQueryClient();
  const [showForm,   setShowForm]   = useState(false);
  const [editTmpl,   setEditTmpl]   = useState<SmsTemplate | undefined>(undefined);
  const [showBulk,   setShowBulk]   = useState(false);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const { data: templates = [], isLoading: loadingTmpl } = useQuery<SmsTemplate[]>({
    queryKey: ["sms-templates"],
    queryFn: async () => (await fetch(`${API}/api/sms/templates`)).json(),
  });

  const { data: logs = [], isLoading: loadingLogs } = useQuery<SmsLog[]>({
    queryKey: ["sms-logs"],
    queryFn: async () => (await fetch(`${API}/api/sms/logs?limit=200`)).json(),
    refetchInterval: 30_000,
  });

  const deleteTmpl = useMutation({
    mutationFn: async (id: number) => fetch(`${API}/api/sms/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sms-templates"] }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`${API}/api/sms/templates/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sms-templates"] }),
  });

  const reminderTemplates = templates.filter(t => t.triggerType.startsWith("reminder_"));
  const manualTemplates   = templates.filter(t => t.triggerType === "manual");

  // Scheduler status cards
  const reminderDays = [6, 5, 4, 3, 2, 1, 0];
  const configuredDays = new Set(reminderTemplates.filter(t => t.isActive).map(t => parseInt(t.triggerType.split("_")[1]!)));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SMS Manager</h1>
          <p className="text-sm text-gray-500 mt-0.5">Send bulk messages and manage automatic expiry reminders</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowBulk(true)} className="gap-2">
            <Send className="w-4 h-4" /> Bulk Send
          </Button>
          <Button onClick={() => { setEditTmpl(undefined); setShowForm(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> New Template
          </Button>
        </div>
      </div>

      {/* Scheduler status row */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-blue-500" />
          <span className="font-semibold text-sm">Auto-Reminder Scheduler</span>
          <span className="text-xs text-gray-500 ml-1">— runs hourly, sends once per subscription per day</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {reminderDays.map(day => {
            const active = configuredDays.has(day);
            return (
              <div key={day} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${active ? "bg-green-50 border-green-300 text-green-700" : "bg-gray-50 border-gray-200 text-gray-400"}`}>
                {active
                  ? <CheckCircle className="w-3 h-3" />
                  : <XCircle className="w-3 h-3" />
                }
                {day === 0 ? "Expiry Day" : `${day} day${day > 1 ? "s" : ""} before`}
              </div>
            );
          })}
        </div>
        {configuredDays.size === 0 && (
          <p className="text-xs text-amber-600 mt-2">No active reminder templates configured. Create reminder templates below to enable automatic SMS notifications.</p>
        )}
      </div>

      <Tabs defaultValue="reminders">
        <TabsList>
          <TabsTrigger value="reminders">
            Expiry Reminders
            {reminderTemplates.length > 0 && <span className="ml-1.5 text-xs bg-blue-100 text-blue-700 rounded-full px-1.5">{reminderTemplates.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="manual">
            Bulk / Manual
            {manualTemplates.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-700 rounded-full px-1.5">{manualTemplates.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="logs">
            Send Logs
            {logs.length > 0 && <span className="ml-1.5 text-xs bg-gray-100 text-gray-700 rounded-full px-1.5">{logs.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* ── Reminder Templates ── */}
        <TabsContent value="reminders" className="mt-4">
          {loadingTmpl ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
          ) : reminderTemplates.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center space-y-3">
              <Clock className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="font-semibold text-gray-600">No reminder templates yet</p>
              <p className="text-sm text-gray-400">Create templates for 0-6 days before expiry — the server will send them automatically every day.</p>
              <Button size="sm" onClick={() => { setEditTmpl(undefined); setShowForm(true); }} className="gap-2">
                <Plus className="w-4 h-4" /> Create First Reminder
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {reminderTemplates
                .sort((a, b) => {
                  const da = parseInt(a.triggerType.split("_")[1]!);
                  const db_ = parseInt(b.triggerType.split("_")[1]!);
                  return db_ - da;
                })
                .map(t => (
                  <div key={t.id} className="rounded-xl border bg-white p-4 shadow-sm flex items-start gap-4">
                    <div className="shrink-0 pt-0.5">{triggerBadge(t.triggerType)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{t.name}</span>
                        {!t.isActive && <span className="text-xs text-gray-400">(inactive)</span>}
                      </div>
                      <p className="text-xs text-gray-500 mt-1 font-mono line-clamp-2">{t.message}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Switch
                        checked={t.isActive}
                        onCheckedChange={v => toggleActive.mutate({ id: t.id, isActive: v })}
                      />
                      <Button size="icon" variant="ghost" onClick={() => { setEditTmpl(t); setShowForm(true); }}>
                        <Pencil className="w-4 h-4 text-gray-500" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => {
                        if (confirm(`Delete template "${t.name}"?`)) deleteTmpl.mutate(t.id);
                      }}>
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </TabsContent>

        {/* ── Manual Templates ── */}
        <TabsContent value="manual" className="mt-4">
          {loadingTmpl ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
          ) : manualTemplates.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center space-y-3">
              <MessageSquare className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="font-semibold text-gray-600">No manual templates</p>
              <p className="text-sm text-gray-400">Save reusable message templates for bulk sends, promotions, or announcements.</p>
              <Button size="sm" onClick={() => { setEditTmpl(undefined); setShowForm(true); }} className="gap-2">
                <Plus className="w-4 h-4" /> Create Template
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {manualTemplates.map(t => (
                <div key={t.id} className="rounded-xl border bg-white p-4 shadow-sm flex items-start gap-4">
                  <div className="shrink-0 pt-0.5">{triggerBadge(t.triggerType)}</div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-sm">{t.name}</span>
                    <p className="text-xs text-gray-500 mt-1 font-mono line-clamp-3">{t.message}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="gap-1 h-8"
                      onClick={() => setShowBulk(true)}>
                      <Send className="w-3.5 h-3.5" /> Send
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => { setEditTmpl(t); setShowForm(true); }}>
                      <Pencil className="w-4 h-4 text-gray-500" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => {
                      if (confirm(`Delete template "${t.name}"?`)) deleteTmpl.mutate(t.id);
                    }}>
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Logs ── */}
        <TabsContent value="logs" className="mt-4">
          {loadingLogs ? (
            <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border bg-white p-10 text-center text-gray-400">
              <p className="font-semibold">No SMS logs yet</p>
              <p className="text-sm mt-1">Sent messages will appear here.</p>
            </div>
          ) : (
            <div className="rounded-xl border bg-white shadow-sm overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead>Date / Time</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map(log => (
                    <>
                      <TableRow key={log.id} className="cursor-pointer hover:bg-gray-50"
                        onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                        <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString("en-KE")}
                        </TableCell>
                        <TableCell className="text-sm font-medium">{log.customerName ?? "—"}</TableCell>
                        <TableCell className="text-sm font-mono">{log.phone}</TableCell>
                        <TableCell>{triggerBadge(log.triggerType)}</TableCell>
                        <TableCell>
                          {log.status === "sent"
                            ? <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle className="w-3.5 h-3.5" /> Sent</span>
                            : <span className="flex items-center gap-1 text-red-500 text-xs font-medium"><XCircle className="w-3.5 h-3.5" /> Failed</span>
                          }
                        </TableCell>
                        <TableCell>
                          {expandedLog === log.id
                            ? <ChevronUp className="w-4 h-4 text-gray-400" />
                            : <ChevronDown className="w-4 h-4 text-gray-400" />
                          }
                        </TableCell>
                      </TableRow>
                      {expandedLog === log.id && (
                        <TableRow key={`${log.id}-exp`} className="bg-gray-50">
                          <TableCell colSpan={6} className="py-3 px-4">
                            <p className="text-xs font-semibold text-gray-500 mb-1">Message sent:</p>
                            <p className="text-sm text-gray-800 font-mono whitespace-pre-wrap">{log.message}</p>
                            {log.error && (
                              <p className="text-xs text-red-500 mt-2"><strong>Error:</strong> {log.error}</p>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      {showForm && (
        <TemplateFormDialog
          open={showForm}
          onClose={() => { setShowForm(false); setEditTmpl(undefined); }}
          initial={editTmpl}
        />
      )}
      {showBulk && (
        <BulkSendDialog
          open={showBulk}
          onClose={() => setShowBulk(false)}
          templates={templates}
        />
      )}
    </div>
  );
}
