import { useState } from "react";
import { Link } from "wouter";
import {
  useListPayments, useCreatePayment,
  useListCustomers, useListInvoices,
  type PaymentInput,
} from "@workspace/api-client-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Plus, CreditCard, ArrowDownToLine, Receipt, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/formatDate";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700 border-green-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  refunded: "bg-gray-100 text-gray-700 border-gray-200",
};

function methodIcon(m: string) {
  if (m === "mpesa") return <Smartphone className="w-4 h-4 text-green-600" />;
  if (m === "card") return <CreditCard className="w-4 h-4 text-gray-500" />;
  if (m === "bank_transfer") return <ArrowDownToLine className="w-4 h-4 text-gray-500" />;
  return <Receipt className="w-4 h-4 text-gray-500" />;
}

function formatMethod(m: string) {
  if (m === "mpesa") return "M-Pesa";
  return m.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

type PayForm = { customerId: string; invoiceId: string; amount: string; method: string; status: string; reference: string; notes: string };
const EMPTY: PayForm = { customerId: "", invoiceId: "", amount: "", method: "mpesa", status: "completed", reference: "", notes: "" };

function PaymentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { fmtMoney } = useCurrency();
  const createMutation = useCreatePayment();
  const { data: customers } = useListCustomers({ limit: 200 });
  const { data: invoicesData } = useListInvoices({ limit: 200 });
  const [form, setForm] = useState<PayForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const set = (k: keyof PayForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const invoices = (invoicesData as any)?.data ?? invoicesData ?? [];
  const customerInvoices = form.customerId
    ? invoices.filter((inv: any) => String(inv.customerId) === form.customerId && inv.status !== "paid" && inv.status !== "cancelled")
    : [];

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await createMutation.mutateAsync({
        data: {
          customerId: Number(form.customerId),
          invoiceId: Number(form.invoiceId),
          amount: Number(form.amount),
          method: form.method as PaymentInput["method"],
          status: form.status as PaymentInput["status"],
          reference: form.reference || undefined,
          notes: form.notes || undefined,
        } as PaymentInput,
      });
      await qc.invalidateQueries({ queryKey: ["/api/payments"] });
      await qc.invalidateQueries({ queryKey: ["/api/invoices"] });
      onClose();
      setForm(EMPTY);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally { setSaving(false); }
  };

  const valid = form.customerId && form.invoiceId && form.amount && form.method;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Customer *</Label>
            <Select value={form.customerId} onValueChange={v => { set("customerId", v); set("invoiceId", ""); set("amount", ""); }}>
              <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
              <SelectContent>
                {customers?.data?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Invoice *</Label>
            <Select value={form.invoiceId} onValueChange={v => {
              set("invoiceId", v);
              const inv = invoices.find((i: any) => String(i.id) === v);
              if (inv) set("amount", String(inv.total ?? inv.amount));
            }}>
              <SelectTrigger><SelectValue placeholder="Select invoice…" /></SelectTrigger>
              <SelectContent>
                {customerInvoices.length > 0
                  ? customerInvoices.map((inv: any) => (
                    <SelectItem key={inv.id} value={String(inv.id)}>
                      INV-{String(inv.id).padStart(5, "0")} — {fmtMoney(inv.total ?? inv.amount)} ({inv.status})
                    </SelectItem>
                  ))
                  : <SelectItem value="" disabled>No unpaid invoices</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={e => set("amount", e.target.value)} placeholder="1500.00" />
            </div>
            <div className="space-y-1"><Label>Method *</Label>
              <Select value={form.method} onValueChange={v => set("method", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mpesa">M-Pesa</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Reference / TXN ID</Label>
              <Input value={form.reference} onChange={e => set("reference", e.target.value)} placeholder="QH2K9XY4JF" />
            </div>
          </div>
          <div className="space-y-1"><Label>Notes</Label>
            <Textarea rows={2} className="resize-none" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        {saveError && <p className="text-sm text-red-600 text-center px-1">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Payments() {
  const { fmtMoney } = useCurrency();
  const { data: paymentsData, isLoading } = useListPayments({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const { canManageBilling } = useCurrentUser();

  const payments = (paymentsData as any)?.data ?? paymentsData ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Payments</h1>
          <p className="text-gray-500 text-sm">Track incoming revenue and transaction history.</p>
        </div>
        {canManageBilling && (
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Record Payment
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Ref / TXN</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              )) : Array.isArray(payments) && payments.length > 0 ? (
                payments.map((payment: any) => (
                  <TableRow key={payment.id} className="hover:bg-gray-50/50">
                    <TableCell className="font-mono text-sm text-gray-500">{payment.reference || `TXN-${String(payment.id).padStart(6, "0")}`}</TableCell>
                    <TableCell className="font-medium text-gray-900">
                      {payment.customer ? <Link href={`/customers/${payment.customerId}`} className="hover:text-blue-600 hover:underline">{payment.customer.name}</Link> : `Customer #${payment.customerId}`}
                    </TableCell>
                    <TableCell className="font-mono text-sm text-blue-600">INV-{String(payment.invoiceId).padStart(5, "0")}</TableCell>
                    <TableCell className="font-bold text-gray-900">{fmtMoney(payment.amount)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-gray-700 text-sm">{methodIcon(payment.method)}{formatMethod(payment.method)}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${STATUS_COLORS[payment.status] ?? ""}`}>{payment.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{formatDate(payment.createdAt, "MMM d, yyyy h:mm a")}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-gray-500">No payments recorded yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <PaymentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
