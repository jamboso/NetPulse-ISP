import { useState } from "react";
import { Link } from "wouter";
import {
  useListSubscriptions, useCreateSubscription, useUpdateSubscription, useDeleteSubscription,
  useListCustomers, useListPlans, useListRouters,
  type SubscriptionInput, type SubscriptionUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Plus, Filter, Pencil, Trash2, Wifi, Copy, Check, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/formatDate";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  suspended: "bg-orange-100 text-orange-700 border-orange-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
  expired: "bg-gray-100 text-gray-700 border-gray-200",
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-1 text-gray-400 hover:text-gray-600 transition-colors">
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

type SubForm = {
  customerId: string; planId: string; routerId: string;
  status: string; startDate: string; endDate: string; ipAddress: string; macAddress: string;
};
const EMPTY: SubForm = {
  customerId: "", planId: "", routerId: "",
  status: "active", startDate: new Date().toISOString().slice(0, 10),
  endDate: "", ipAddress: "", macAddress: "",
};

function SubscriptionDialog({ open, onClose, initial, subId }: {
  open: boolean; onClose: () => void; initial?: SubForm; subId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateSubscription();
  const updateMutation = useUpdateSubscription();
  const { data: customers } = useListCustomers({ limit: 200 });
  const { data: plans } = useListPlans();
  const { data: routers } = useListRouters();
  const [form, setForm] = useState<SubForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof SubForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (subId) {
        const upd: SubscriptionUpdate = {
          planId: Number(form.planId) || undefined,
          routerId: form.routerId ? Number(form.routerId) : null,
          status: form.status as SubscriptionUpdate["status"],
          endDate: form.endDate || null,
          ipAddress: form.ipAddress || null,
          macAddress: form.macAddress || null,
        };
        await updateMutation.mutateAsync({ id: subId, data: upd });
      } else {
        const inp: SubscriptionInput = {
          customerId: Number(form.customerId),
          planId: Number(form.planId),
          routerId: form.routerId ? Number(form.routerId) : undefined,
          status: form.status as SubscriptionInput["status"],
          startDate: form.startDate,
          endDate: form.endDate || undefined,
          ipAddress: form.ipAddress || undefined,
          macAddress: form.macAddress || undefined,
        };
        await createMutation.mutateAsync({ data: inp });
      }
      await qc.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      onClose();
    } finally { setSaving(false); }
  };

  const valid = subId ? (form.planId && form.status) : (form.customerId && form.planId && form.startDate);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{subId ? "Edit Subscription" : "New Subscription"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!subId && (
            <div className="space-y-1"><Label>Customer *</Label>
              <Select value={form.customerId} onValueChange={v => set("customerId", v)}>
                <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
                <SelectContent>
                  {customers?.data?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1"><Label>Plan *</Label>
            <Select value={form.planId} onValueChange={v => set("planId", v)}>
              <SelectTrigger><SelectValue placeholder="Select plan…" /></SelectTrigger>
              <SelectContent>
                {plans?.filter(p => p.isActive).map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name} — ${p.price}/{p.billingCycle}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5 text-blue-500" /> RouterOS Device</Label>
            <Select value={form.routerId || "none"} onValueChange={v => set("routerId", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None (no auto-provisioning)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {routers?.map(r => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name} ({r.ipAddress})</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.routerId && form.status === "active" && !subId && (
              <p className="text-xs text-blue-600 flex items-center gap-1 mt-1">
                <KeyRound className="w-3 h-3" /> PPPoE secret will be auto-created on save
              </p>
            )}
          </div>
          <div className="space-y-1"><Label>Status</Label>
            <Select value={form.status} onValueChange={v => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!subId && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Start Date *</Label>
                <Input type="date" value={form.startDate} onChange={e => set("startDate", e.target.value)} />
              </div>
              <div className="space-y-1"><Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={e => set("endDate", e.target.value)} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>IP Address</Label>
              <Input value={form.ipAddress} onChange={e => set("ipAddress", e.target.value)} placeholder="192.168.1.100" />
            </div>
            <div className="space-y-1"><Label>MAC Address</Label>
              <Input value={form.macAddress} onChange={e => set("macAddress", e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : subId ? "Update" : "Create Subscription"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Subscriptions() {
  const { canManageBilling, canDeleteBillingRecords } = useCurrentUser();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: subscriptionsData, isLoading } = useListSubscriptions(statusFilter ? { status: statusFilter } : undefined);
  const deleteMutation = useDeleteSubscription();
  const [dialog, setDialog] = useState<{ open: boolean; id?: number; initial?: SubForm }>({ open: false });

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this subscription? This will also remove the PPPoE secret from the router.")) return;
    await deleteMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/subscriptions"] });
  };

  const subs: any[] = Array.isArray(subscriptionsData) ? subscriptionsData : [];

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Subscriptions</h1>
          <p className="text-gray-500 text-sm">Manage active services and connections. PPPoE secrets are auto-provisioned on RouterOS.</p>
        </div>
        {canManageBilling && (
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialog({ open: true })}>
            <Plus className="w-4 h-4 mr-2" /> New Subscription
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex gap-2 flex-wrap">
          <div className="flex items-center text-sm text-gray-500 mr-2"><Filter className="w-4 h-4 mr-2" /> Filter:</div>
          {["all", "active", "suspended", "cancelled", "expired"].map(status => (
            <Button key={status} variant={statusFilter === status || (status === "all" && !statusFilter) ? "default" : "outline"} size="sm"
              onClick={() => setStatusFilter(status === "all" ? undefined : status)}
              className={statusFilter === status || (status === "all" && !statusFilter) ? "bg-blue-600" : "bg-white"}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>PPPoE Credentials</TableHead>
                <TableHead>IP / MAC</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              )) : Array.isArray(subs) && subs.length > 0 ? (
                (subs as any[]).map((sub: any) => (
                  <TableRow key={sub.id} className="hover:bg-gray-50/50">
                    <TableCell className="font-medium text-gray-900">
                      {sub.customer
                        ? <Link href={`/customers/${sub.customerId}`} className="hover:text-blue-600 hover:underline">{sub.customer.name}</Link>
                        : `Customer #${sub.customerId}`}
                    </TableCell>
                    <TableCell>{sub.plan ? sub.plan.name : `Plan #${sub.planId}`}</TableCell>
                    <TableCell>
                      {sub.pppoeUsername ? (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-0.5 font-mono text-xs text-gray-700">
                            <KeyRound className="w-3 h-3 text-blue-400 flex-shrink-0" />
                            <span>{sub.pppoeUsername}</span>
                            <CopyButton value={sub.pppoeUsername} />
                          </div>
                          <div className="flex items-center gap-0.5 font-mono text-xs text-gray-500">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default tracking-widest">••••••••••</span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="font-mono text-sm">
                                {sub.pppoePassword}
                              </TooltipContent>
                            </Tooltip>
                            <CopyButton value={sub.pppoePassword ?? ""} />
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-xs">Not provisioned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-mono text-gray-600">{sub.ipAddress || "—"}</div>
                      <div className="text-xs font-mono text-gray-400">{sub.macAddress || "—"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${STATUS_COLORS[sub.status] ?? ""}`}>{sub.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{formatDate(sub.startDate)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canManageBilling && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                            onClick={() => setDialog({ open: true, id: sub.id, initial: {
                              customerId: String(sub.customerId), planId: String(sub.planId),
                              routerId: sub.routerId ? String(sub.routerId) : "",
                              status: sub.status, startDate: sub.startDate?.slice(0, 10) ?? "",
                              endDate: sub.endDate?.slice(0, 10) ?? "", ipAddress: sub.ipAddress ?? "", macAddress: sub.macAddress ?? "",
                            }})}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {canDeleteBillingRecords && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600" onClick={() => handleDelete(sub.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-gray-500">No subscriptions found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {dialog.open && (
        <SubscriptionDialog open={dialog.open} onClose={() => setDialog({ open: false })} initial={dialog.initial} subId={dialog.id} />
      )}
    </div>
    </TooltipProvider>
  );
}
