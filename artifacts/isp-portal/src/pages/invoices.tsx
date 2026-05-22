import { useState } from "react";
import { Link } from "wouter";
import {
  useListInvoices, useCreateInvoice, useUpdateInvoice, useDeleteInvoice,
  useListCustomers, useListSubscriptions,
  type InvoiceInput, type InvoiceUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBulkSelect } from "@/hooks/useBulkSelect";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Plus, Filter, Download, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/formatDate";

const STATUS_COLORS: Record<string, string> = {
  paid: "bg-green-100 text-green-700 border-green-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
  sent: "bg-blue-100 text-blue-700 border-blue-200",
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
};

type InvForm = { customerId: string; subscriptionId: string; amount: string; tax: string; status: string; dueDate: string; notes: string };
const EMPTY: InvForm = {
  customerId: "", subscriptionId: "", amount: "", tax: "0",
  status: "draft", dueDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), notes: "",
};

function InvoiceDialog({ open, onClose, initial, invoiceId }: {
  open: boolean; onClose: () => void; initial?: InvForm; invoiceId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateInvoice();
  const updateMutation = useUpdateInvoice();
  const { data: customers } = useListCustomers({ limit: 200 });
  const { data: subscriptionsData } = useListSubscriptions({ limit: 200 } as any);
  const [form, setForm] = useState<InvForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof InvForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const subs = Array.isArray(subscriptionsData) ? subscriptionsData : (subscriptionsData as any)?.data ?? [];
  const customerSubs = form.customerId ? subs.filter((s: any) => String(s.customerId) === form.customerId) : [];

  const handleSave = async () => {
    setSaving(true);
    try {
      if (invoiceId) {
        const upd: InvoiceUpdate = {
          amount: Number(form.amount) || undefined,
          tax: Number(form.tax) || undefined,
          status: form.status as InvoiceUpdate["status"],
          dueDate: form.dueDate || undefined,
          notes: form.notes || null,
        };
        await updateMutation.mutateAsync({ id: invoiceId, data: upd });
      } else {
        const inp: InvoiceInput = {
          customerId: Number(form.customerId),
          subscriptionId: form.subscriptionId ? Number(form.subscriptionId) : undefined,
          amount: Number(form.amount),
          tax: Number(form.tax) || 0,
          status: form.status as InvoiceInput["status"],
          dueDate: form.dueDate,
          notes: form.notes || undefined,
        };
        await createMutation.mutateAsync({ data: inp });
      }
      await qc.invalidateQueries({ queryKey: ["/api/invoices"] });
      onClose();
    } finally { setSaving(false); }
  };

  const valid = invoiceId ? (form.amount && form.dueDate) : (form.customerId && form.amount && form.dueDate);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{invoiceId ? "Edit Invoice" : "Create Invoice"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!invoiceId && (
            <>
              <div className="space-y-1"><Label>Customer *</Label>
                <Select value={form.customerId} onValueChange={v => { set("customerId", v); set("subscriptionId", ""); }}>
                  <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
                  <SelectContent>
                    {customers?.data?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {customerSubs.length > 0 && (
                <div className="space-y-1"><Label>Subscription (optional)</Label>
                  <Select value={form.subscriptionId} onValueChange={v => set("subscriptionId", v)}>
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {customerSubs.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>Sub #{s.id} — {s.plan?.name ?? `Plan #${s.planId}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="1500.00" />
            </div>
            <div className="space-y-1"><Label>Tax</Label>
              <Input type="number" value={form.tax} onChange={e => set("tax", e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Due Date *</Label>
              <Input type="date" value={form.dueDate} onChange={e => set("dueDate", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1"><Label>Notes</Label>
            <Textarea rows={2} className="resize-none" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : invoiceId ? "Update" : "Create Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Invoices() {
  const { canManageBilling, canDeleteBillingRecords } = useCurrentUser();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: invoicesData, isLoading } = useListInvoices(statusFilter ? { status: statusFilter, limit: 50 } : { limit: 50 });
  const deleteMutation = useDeleteInvoice();
  const updateMutation = useUpdateInvoice();
  const [dialog, setDialog] = useState<{ open: boolean; id?: number; initial?: InvForm }>({ open: false });
  const [bulkWorking, setBulkWorking] = useState(false);

  const invoices: any[] = (invoicesData as any)?.data ?? invoicesData ?? [];
  const ids = invoices.map((inv: any) => inv.id as number);
  const { selected, toggle, toggleAll, clear, isAllSelected, isIndeterminate } = useBulkSelect(ids);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this invoice?")) return;
    await deleteMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/invoices"] });
  };

  const handleMarkPaid = async (id: number) => {
    await updateMutation.mutateAsync({ id, data: { status: "paid" } as InvoiceUpdate });
    qc.invalidateQueries({ queryKey: ["/api/invoices"] });
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} invoice(s)?`)) return;
    setBulkWorking(true);
    try {
      await Promise.all([...selected].map(id => deleteMutation.mutateAsync({ id })));
      clear();
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    } finally { setBulkWorking(false); }
  };

  const handleBulkMarkPaid = async () => {
    setBulkWorking(true);
    try {
      await Promise.all([...selected].map(id =>
        updateMutation.mutateAsync({ id, data: { status: "paid" } as InvoiceUpdate })
      ));
      clear();
      qc.invalidateQueries({ queryKey: ["/api/invoices"] });
    } finally { setBulkWorking(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Invoices</h1>
          <p className="text-gray-500 text-sm">Manage billing and payments.</p>
        </div>
        {canManageBilling && (
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialog({ open: true })}>
            <Plus className="w-4 h-4 mr-2" /> Create Invoice
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2">
          <div className="flex items-center text-sm text-gray-500 mr-2"><Filter className="w-4 h-4 mr-2" /> Filter:</div>
          {["all", "paid", "overdue", "sent", "draft"].map(status => (
            <Button key={status} variant={statusFilter === status || (status === "all" && !statusFilter) ? "default" : "outline"} size="sm"
              onClick={() => { setStatusFilter(status === "all" ? undefined : status); clear(); }}
              className={statusFilter === status || (status === "all" && !statusFilter) ? "bg-blue-600" : "bg-white"}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>

        <BulkActionBar
          count={selected.size}
          onClear={clear}
          actions={[
            ...(canManageBilling ? [{
              label: bulkWorking ? "Working…" : "Mark as Paid",
              icon: <CheckCircle2 className="w-3.5 h-3.5" />,
              className: "text-green-600 border-green-200 hover:bg-green-50",
              onClick: () => void handleBulkMarkPaid(),
            }] : []),
            ...(canDeleteBillingRecords ? [{
              label: bulkWorking ? "Working…" : "Delete",
              icon: <Trash2 className="w-3.5 h-3.5" />,
              className: "text-red-600 border-red-200 hover:bg-red-50",
              onClick: () => void handleBulkDelete(),
            }] : []),
          ]}
        />

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={isAllSelected ? true : isIndeterminate ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Invoice ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              )) : invoices.length > 0 ? (
                invoices.map((invoice: any) => (
                  <TableRow key={invoice.id} className={`hover:bg-gray-50/50 ${selected.has(invoice.id) ? "bg-blue-50/40" : ""}`}>
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(invoice.id)}
                        onCheckedChange={() => toggle(invoice.id)}
                        aria-label={`Select invoice ${invoice.id}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm text-gray-500">INV-{String(invoice.id).padStart(5, "0")}</TableCell>
                    <TableCell className="font-medium text-gray-900">
                      {invoice.customer ? <Link href={`/customers/${invoice.customerId}`} className="hover:text-blue-600 hover:underline">{invoice.customer.name}</Link> : `Customer #${invoice.customerId}`}
                    </TableCell>
                    <TableCell className="font-bold text-gray-900">${(invoice.total ?? invoice.amount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${STATUS_COLORS[invoice.status] ?? ""}`}>{invoice.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{formatDate(invoice.createdAt)}</TableCell>
                    <TableCell className={`text-sm ${invoice.status === "overdue" ? "text-red-600 font-medium" : "text-gray-600"}`}>
                      {formatDate(invoice.dueDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {canManageBilling && invoice.status !== "paid" && invoice.status !== "cancelled" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                            title="Mark as Paid" onClick={() => handleMarkPaid(invoice.id)}>
                            <CheckCircle2 className="w-4 h-4" />
                          </Button>
                        )}
                        {canManageBilling && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                            onClick={() => setDialog({ open: true, id: invoice.id, initial: {
                              customerId: String(invoice.customerId), subscriptionId: String(invoice.subscriptionId ?? ""),
                              amount: String(invoice.amount), tax: String(invoice.tax ?? 0),
                              status: invoice.status, dueDate: invoice.dueDate?.slice(0, 10) ?? "",
                              notes: invoice.notes ?? "",
                            }})}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-600">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                        {canDeleteBillingRecords && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                            onClick={() => handleDelete(invoice.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={8} className="h-24 text-center text-gray-500">No invoices found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <InvoiceDialog open={dialog.open} onClose={() => setDialog({ open: false })} initial={dialog.initial} invoiceId={dialog.id} />
    </div>
  );
}
