import { Link, useParams } from "wouter";
import {
  getListAuditLogsQueryKey,
  useGetInvoice,
  useGetPayment,
  useListAuditLogs,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  Hash,
  Receipt,
  User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/hooks/useCurrency";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDate } from "@/lib/formatDate";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-700 border-green-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  refunded: "bg-gray-100 text-gray-700 border-gray-200",
};

function formatMethod(method: string) {
  if (method === "mpesa") return "M-Pesa";
  return method.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function AuditActionIcon({ action }: { action: string }) {
  if (action === "delete") return <XCircle className="w-4 h-4 text-red-600" />;
  if (action === "update") return <ClipboardList className="w-4 h-4 text-blue-600" />;
  return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
}

export default function PaymentDetail() {
  const { id } = useParams();
  const paymentId = Number.parseInt(id ?? "0", 10);
  const { fmtMoney } = useCurrency();
  const { isAdmin, isOwner } = useCurrentUser();
  const canViewAuditHistory = isAdmin || isOwner;

  const { data: payment, isLoading: isPaymentLoading } = useGetPayment(paymentId);
  const { data: invoice, isLoading: isInvoiceLoading } = useGetInvoice(payment?.invoiceId ?? 0);
  const auditParams = { entityType: "payment", entityId: paymentId, limit: 20 };
  const {
    data: auditData,
    isLoading: isAuditLoading,
    isError: isAuditError,
  } = useListAuditLogs(auditParams, {
    query: {
      queryKey: getListAuditLogsQueryKey(auditParams),
      enabled: canViewAuditHistory && paymentId > 0,
    },
  });

  if (isPaymentLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-36" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="lg:col-span-2 h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!payment) {
    return (
      <div className="text-center py-12">
        <h1 className="text-xl font-bold text-gray-900">Payment not found</h1>
        <p className="text-gray-500 mt-2">The payment record you're looking for doesn't exist.</p>
        <Button asChild className="mt-4">
          <Link href="/payments">Back to Payments</Link>
        </Button>
      </div>
    );
  }

  const auditLogs = auditData?.data ?? [];
  const paymentReference = payment.reference || `TXN-${String(payment.id).padStart(6, "0")}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild className="h-8 w-8">
          <Link href="/payments" aria-label="Back to payments">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="text-sm text-gray-500">Payment</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 font-mono truncate">
            {paymentReference}
          </h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row gap-4 sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Amount received</p>
                <p className="text-2xl font-bold text-gray-900">{fmtMoney(payment.amount)}</p>
              </div>
            </div>
            <Badge variant="outline" className={`capitalize w-fit ${STATUS_COLORS[payment.status] ?? ""}`}>
              {payment.status}
            </Badge>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            <div className="p-5 space-y-1">
              <dt className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" /> Reference / transaction ID
              </dt>
              <dd className="font-mono text-sm text-gray-900 break-all">{paymentReference}</dd>
            </div>
            <div className="p-5 space-y-1">
              <dt className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5" /> Payment method
              </dt>
              <dd className="text-sm text-gray-900">{formatMethod(payment.method)}</dd>
            </div>
            <div className="p-5 space-y-1 border-t border-gray-100">
              <dt className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Recorded
              </dt>
              <dd className="text-sm text-gray-900">{formatDate(payment.createdAt, "MMM d, yyyy h:mm a")}</dd>
            </div>
            <div className="p-5 space-y-1 border-t border-gray-100">
              <dt className="text-xs font-medium text-gray-500">Payment ID</dt>
              <dd className="font-mono text-sm text-gray-900">#{payment.id}</dd>
            </div>
          </dl>

          <div className="p-5 border-t border-gray-100">
            <h2 className="text-xs font-medium text-gray-500 mb-2">Notes</h2>
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{payment.notes || "No notes recorded."}</p>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Customer</h2>
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <Link href={`/customers/${payment.customerId}`} className="font-medium text-blue-600 hover:underline block truncate">
                  {payment.customer?.name || `Customer #${payment.customerId}`}
                </Link>
                {payment.customer?.email && <p className="text-sm text-gray-600 truncate mt-1">{payment.customer.email}</p>}
                {payment.customer?.phone && <p className="text-sm text-gray-600">{payment.customer.phone}</p>}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">Invoice</h2>
            {isInvoiceLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : payment.invoiceId ? (
              <div className="space-y-2">
                <Link href="/invoices" className="inline-flex items-center gap-2 font-medium text-blue-600 hover:underline">
                  <FileText className="w-4 h-4" />
                  INV-{String(payment.invoiceId).padStart(5, "0")}
                </Link>
                {invoice && (
                  <>
                    <p className="text-sm text-gray-700">{fmtMoney(invoice.total ?? invoice.amount)}</p>
                    <Badge variant="outline" className="capitalize">{invoice.status}</Badge>
                  </>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No invoice is linked to this payment.</p>
            )}
          </section>
        </aside>
      </div>

      <section className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" /> Audit history
            </h2>
            <p className="text-sm text-gray-500 mt-1">Changes recorded for this payment.</p>
          </div>
          {canViewAuditHistory && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/audit-logs?entityType=payment&entityId=${payment.id}`}>View audit log</Link>
            </Button>
          )}
        </div>

        {!canViewAuditHistory ? (
          <p className="p-5 text-sm text-gray-500">Audit history is available to administrators.</p>
        ) : isAuditLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isAuditError ? (
          <p className="p-5 text-sm text-red-600">Audit history could not be loaded. Please try again.</p>
        ) : auditLogs.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">No audit activity has been recorded for this payment yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {auditLogs.map((log) => (
              <div key={log.id} className="px-5 py-4 flex items-start gap-3">
                <div className="mt-0.5"><AuditActionIcon action={log.action} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900">
                    <span className="font-medium capitalize">{log.action}</span> by {log.userEmail || "Unknown user"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{formatDate(log.createdAt, "MMM d, yyyy h:mm a")}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}