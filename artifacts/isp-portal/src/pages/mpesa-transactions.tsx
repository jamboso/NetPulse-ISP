import { useQuery } from "@tanstack/react-query";
import { Smartphone, TrendingUp, CheckCircle2, Clock, XCircle, RefreshCw, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type MpesaTx = {
  id: number;
  amount: string;
  status: string;
  reference: string | null;
  notes: string | null;
  createdAt: string | null;
  invoiceId: number | null;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
};

function extractPhone(notes: string | null, customerPhone: string | null): string {
  if (customerPhone) return customerPhone;
  if (!notes) return "—";
  const m = notes.match(/Phone:\s*([\d+]+)/);
  return m ? m[1] : "—";
}

function formatPhone(p: string): string {
  if (p === "—") return p;
  const d = p.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("254")) return `+254 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}`;
  if (d.length === 9) return `+254 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return p;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function fullTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const STATUS_CFG: Record<string, { label: string; cls: string; icon: React.ElementType }> = {
  completed: { label: "Confirmed",  cls: "bg-green-100 text-green-700 border-green-200",   icon: CheckCircle2 },
  pending:   { label: "Pending",    cls: "bg-yellow-100 text-yellow-800 border-yellow-200", icon: Clock },
  failed:    { label: "Failed",     cls: "bg-red-100 text-red-700 border-red-200",           icon: XCircle },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { label: status, cls: "bg-gray-100 text-gray-600 border-gray-200", icon: Clock };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function KESAmount({ amount }: { amount: string }) {
  const n = Number(amount);
  return (
    <span className="font-semibold text-gray-900 tabular-nums">
      KES {n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export default function MpesaTransactions() {
  const { data, isPending, dataUpdatedAt, isFetching } = useQuery<{ data: MpesaTx[]; total: number }>({
    queryKey: ["mpesa-transactions"],
    queryFn: () => fetch("/api/mpesa/transactions?limit=200").then((r) => r.json()),
    refetchInterval: 1000,
    staleTime: 0,
  });

  const txns = data?.data ?? [];

  // Stats
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayTxns   = txns.filter((t) => t.createdAt && new Date(t.createdAt) >= todayStart);
  const todayTotal  = todayTxns.reduce((s, t) => s + Number(t.amount), 0);
  const todayCount  = todayTxns.length;
  const pendingCount = txns.filter((t) => t.status === "pending").length;
  const allTotal    = txns.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Smartphone className="w-6 h-6 text-green-600" />
            <h1 className="text-2xl font-bold text-gray-900">M-Pesa Transactions</h1>
            {/* Live pulse */}
            <span className="flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5 text-xs font-medium text-green-700">
              <span className={`w-2 h-2 rounded-full ${isFetching ? "bg-green-500 animate-pulse" : "bg-green-400"}`} />
              LIVE
            </span>
          </div>
          <p className="text-sm text-gray-400">
            Updates every second · {txns.length} total transactions
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {dataUpdatedAt ? `Last: ${new Date(dataUpdatedAt).toLocaleTimeString()}` : "Loading…"}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Today's Revenue",
            value: `KES ${todayTotal.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
            sub: `${todayCount} payment${todayCount !== 1 ? "s" : ""} today`,
            color: "text-green-700",
            bg: "bg-green-50 border-green-200",
            icon: TrendingUp,
          },
          {
            label: "All-Time Total",
            value: `KES ${allTotal.toLocaleString("en-KE", { minimumFractionDigits: 2 })}`,
            sub: `${txns.length} transactions`,
            color: "text-blue-700",
            bg: "bg-blue-50 border-blue-200",
            icon: Smartphone,
          },
          {
            label: "Confirmed",
            value: String(txns.filter((t) => t.status === "completed").length),
            sub: "successful payments",
            color: "text-emerald-700",
            bg: "bg-emerald-50 border-emerald-200",
            icon: CheckCircle2,
          },
          {
            label: "Pending",
            value: String(pendingCount),
            sub: "awaiting confirmation",
            color: "text-yellow-700",
            bg: "bg-yellow-50 border-yellow-200",
            icon: Clock,
          },
        ].map(({ label, value, sub, color, bg, icon: Icon }) => (
          <div key={label} className={`rounded-xl border p-4 ${bg}`}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <p className={`text-xl font-bold ${color} tabular-nums leading-tight`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
          </div>
        ))}
      </div>

      {/* Transaction feed */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 bg-gray-50/60">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-green-500" />
            <span className="text-sm font-semibold text-gray-700">Live Feed</span>
          </div>
          <span className="text-xs text-gray-400">Newest first</span>
        </div>

        {isPending ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : txns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
              <Smartphone className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-gray-700 font-medium text-sm">No M-Pesa transactions yet</p>
            <p className="text-gray-400 text-xs mt-1 max-w-xs">
              Transactions will appear here in real-time as customers pay via M-Pesa STK Push or C2B Paybill.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {txns.map((tx, idx) => {
              const phone = extractPhone(tx.notes, tx.customerPhone);
              const isNew = idx < 3 && tx.createdAt && (Date.now() - new Date(tx.createdAt).getTime()) < 10_000;
              return (
                <div
                  key={tx.id}
                  className={`flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50/70 transition-colors ${
                    isNew ? "bg-green-50/40" : ""
                  }`}
                >
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    tx.status === "completed" ? "bg-green-100" :
                    tx.status === "pending"   ? "bg-yellow-100" : "bg-red-100"
                  }`}>
                    <Smartphone className={`w-4 h-4 ${
                      tx.status === "completed" ? "text-green-600" :
                      tx.status === "pending"   ? "text-yellow-600" : "text-red-500"
                    }`} />
                  </div>

                  {/* Receipt + customer */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 font-mono tracking-wide">
                        {tx.reference ?? "—"}
                      </span>
                      {isNew && (
                        <span className="text-[10px] font-bold uppercase tracking-widest text-green-600 bg-green-100 rounded px-1.5 py-0.5">
                          NEW
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400 flex-wrap">
                      <span>{tx.customerName ?? "Unknown customer"}</span>
                      <span className="text-gray-300">·</span>
                      <span className="font-mono">{formatPhone(phone)}</span>
                      {tx.invoiceId && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span>Invoice #{tx.invoiceId}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right shrink-0">
                    <KESAmount amount={tx.amount} />
                    <p className="text-xs text-gray-400 mt-0.5 tabular-nums">
                      <span title={fullTime(tx.createdAt)}>{timeAgo(tx.createdAt)}</span>
                    </p>
                  </div>

                  {/* Status */}
                  <div className="shrink-0 hidden sm:block">
                    <StatusBadge status={tx.status} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
