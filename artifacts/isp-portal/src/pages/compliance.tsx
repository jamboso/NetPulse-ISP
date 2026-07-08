import { useState, useRef } from "react";
import { useListCustomers } from "@workspace/api-client-react";
import {
  Shield, Search, Download, Calendar, User, Wifi,
  Clock, Upload, ArrowDownToLine, FileText, AlertCircle,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatDate";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (!n) return "0 B";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtDuration(start: string, end: string | null): string {
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const secs = Math.floor((e.getTime() - s.getTime()) / 1000);
  if (secs < 60)  return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ${secs%60}s`;
  const h = Math.floor(secs/3600);
  const m = Math.floor((secs%3600)/60);
  return `${h}h ${m}m`;
}

function dt(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "short", timeStyle: "medium",
  });
}

// ── types ─────────────────────────────────────────────────────────────────────

interface SessionLog {
  id: number;
  customerId: number;
  subscriptionId: number;
  pppoeUsername: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  sessionType: string;
  routerName: string | null;
  bytesIn: number;
  bytesOut: number;
  sessionStart: string;
  sessionEnd: string | null;
}

interface Subscription {
  id: number;
  pppoeUsername: string | null;
  ipAddress: string | null;
  status: string;
  plan: { name: string } | null;
}

interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  status: string;
  createdAt: string;
}

interface Report {
  generatedAt: string;
  period: { from: string; to: string };
  customer: Customer;
  subscriptions: Subscription[];
  sessions: SessionLog[];
  summary: { totalSessions: number; totalBytesIn: number; totalBytesOut: number; totalBytes: number };
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Compliance() {
  const [search, setSearch]           = useState("");
  const [selectedId, setSelectedId]   = useState<number | null>(null);
  const [dateFrom, setDateFrom]       = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo]           = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport]           = useState<Report | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const printRef                      = useRef<HTMLDivElement>(null);

  const { data: customersData } = useListCustomers({ search, limit: 20 });
  const customers = Array.isArray(customersData) ? customersData : (customersData as any)?.data ?? [];

  async function fetchReport() {
    if (!selectedId) return;
    setLoading(true); setError(null); setReport(null);
    try {
      const res = await fetch(
        `/api/compliance/report?customerId=${selectedId}&from=${dateFrom}&to=${dateTo}`
      );
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load report");
      setReport(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const selectedCustomer = customers.find((c: any) => c.id === selectedId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" /> Compliance Reports
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate subscriber session history reports for regulatory and authority requests.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5 print:hidden">
        <h2 className="font-semibold text-gray-900 text-sm">Generate Report</h2>

        {/* Customer search */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1.5">Subscriber</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Search by name, email or phone…"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedId(null); setReport(null); }}
            />
          </div>
          {search.length >= 2 && customers.length > 0 && !selectedId && (
            <div className="mt-1 border border-gray-200 rounded-lg bg-white shadow-lg z-10 overflow-hidden">
              {customers.slice(0, 8).map((c: any) => (
                <button
                  key={c.id}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 flex items-center justify-between text-sm border-b border-gray-50 last:border-0"
                  onClick={() => { setSelectedId(c.id); setSearch(c.name); }}
                >
                  <div>
                    <p className="font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.email} · {c.phone}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] capitalize ${c.status === "active" ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100"}`}>
                    {c.status}
                  </Badge>
                </button>
              ))}
            </div>
          )}
          {selectedCustomer && (
            <div className="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <User className="w-3.5 h-3.5" />
              <span>Selected: <strong>{selectedCustomer.name}</strong> — {selectedCustomer.email}</span>
            </div>
          )}
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> From
            </label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> To
            </label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
        </div>

        <Button
          onClick={fetchReport}
          disabled={!selectedId || loading}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {loading ? "Generating…" : <><FileText className="w-4 h-4 mr-2" /> Generate Report</>}
        </Button>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* Skeleton */}
      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {/* Report */}
      {report && (
        <div ref={printRef}>
          {/* Print action bar */}
          <div className="flex items-center justify-between mb-4 print:hidden">
            <p className="text-sm text-gray-500">
              Report generated at {dt(report.generatedAt)}
            </p>
            <Button variant="outline" onClick={handlePrint} className="gap-2">
              <Printer className="w-4 h-4" /> Print / Save PDF
            </Button>
          </div>

          {/* ── Report header ── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4 print-section">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-5 h-5 text-blue-600" />
                  <h2 className="text-lg font-bold text-gray-900">Subscriber Compliance Report</h2>
                </div>
                <p className="text-xs text-gray-500">
                  Period: <strong>{dateFrom}</strong> to <strong>{dateTo}</strong> ·
                  Generated: <strong>{dt(report.generatedAt)}</strong>
                </p>
              </div>
              <div className="text-right text-xs text-gray-400">
                <p className="font-semibold text-gray-700">NetPulse ISP Manager</p>
                <p>Ref: CPL-{report.customer.id}-{Date.now().toString().slice(-6)}</p>
              </div>
            </div>
          </div>

          {/* ── Subscriber profile ── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-blue-500" /> Subscriber Information
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
              {[
                ["Full Name",     report.customer.name],
                ["Account No.",   `#${report.customer.id}`],
                ["Email",         report.customer.email],
                ["Phone",         report.customer.phone ?? "—"],
                ["Address",       report.customer.address ?? "—"],
                ["Customer Since",formatDate(report.customer.createdAt, "dd MMM yyyy")],
                ["Account Status",report.customer.status.toUpperCase()],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-2">
                  <span className="text-gray-500 w-32 shrink-0">{label}:</span>
                  <span className="font-medium text-gray-900">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Subscriptions ── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-4">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 text-sm">
              <Wifi className="w-4 h-4 text-blue-500" /> Service Subscriptions
            </h3>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase">
                  <th className="pb-2 font-medium">Plan</th>
                  <th className="pb-2 font-medium">Username</th>
                  <th className="pb-2 font-medium">Assigned IP</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {report.subscriptions.map(s => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="py-2 font-medium">{s.plan?.name ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{s.pppoeUsername ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{s.ipAddress ?? "Dynamic"}</td>
                    <td className="py-2">
                      <span className={`capitalize text-xs font-medium ${s.status === "active" ? "text-green-600" : "text-gray-500"}`}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Summary ── */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {[
              { icon: <Clock className="w-4 h-4 text-blue-500" />,        label: "Total Sessions",   value: report.summary.totalSessions.toString() },
              { icon: <ArrowDownToLine className="w-4 h-4 text-green-500" />, label: "Total Downloaded", value: fmtBytes(report.summary.totalBytesIn) },
              { icon: <Upload className="w-4 h-4 text-orange-500" />,     label: "Total Uploaded",   value: fmtBytes(report.summary.totalBytesOut) },
              { icon: <Download className="w-4 h-4 text-purple-500" />,   label: "Total Data",       value: fmtBytes(report.summary.totalBytes) },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-center">
                <div className="flex justify-center mb-1">{k.icon}</div>
                <p className="text-xs text-gray-500">{k.label}</p>
                <p className="text-lg font-bold text-gray-900">{k.value}</p>
              </div>
            ))}
          </div>

          {/* ── Session logs ── */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              <h3 className="font-semibold text-gray-900 text-sm">
                Session History ({report.sessions.length} sessions)
              </h3>
            </div>

            {report.sessions.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                No sessions recorded in this date range.
                <p className="text-xs mt-1">Session logging begins automatically once a user connects online.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-left text-[11px] text-gray-500 uppercase">
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Session Start</th>
                      <th className="px-4 py-3 font-medium">Session End</th>
                      <th className="px-4 py-3 font-medium">Duration</th>
                      <th className="px-4 py-3 font-medium">IP Address</th>
                      <th className="px-4 py-3 font-medium">MAC Address</th>
                      <th className="px-4 py-3 font-medium">Username</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">↓ Data In</th>
                      <th className="px-4 py-3 font-medium">↑ Data Out</th>
                      <th className="px-4 py-3 font-medium">Router</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.sessions.map((s, i) => (
                      <tr key={s.id} className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}>
                        <td className="px-4 py-2.5 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2.5 font-mono whitespace-nowrap">{dt(s.sessionStart)}</td>
                        <td className="px-4 py-2.5 font-mono whitespace-nowrap">
                          {s.sessionEnd
                            ? dt(s.sessionEnd)
                            : <span className="text-green-600 font-medium">Active</span>}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">{fmtDuration(s.sessionStart, s.sessionEnd)}</td>
                        <td className="px-4 py-2.5 font-mono">{s.ipAddress ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono">{s.macAddress ?? "—"}</td>
                        <td className="px-4 py-2.5 font-mono">{s.pppoeUsername ?? "—"}</td>
                        <td className="px-4 py-2.5 capitalize">{s.sessionType}</td>
                        <td className="px-4 py-2.5 text-green-700 font-medium">{fmtBytes(s.bytesIn)}</td>
                        <td className="px-4 py-2.5 text-orange-600 font-medium">{fmtBytes(s.bytesOut)}</td>
                        <td className="px-4 py-2.5">{s.routerName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Legal footer */}
          <div className="text-xs text-gray-400 text-center py-2 print-section">
            This report is generated from ISP network records and is intended for authorized use only.
            Unauthorized disclosure is prohibited. — NetPulse ISP Manager
          </div>
        </div>
      )}
    </div>
  );
}
