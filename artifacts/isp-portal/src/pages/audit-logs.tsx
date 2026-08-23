import React, { useState, useRef, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import {
  useListAuditLogs,
  getListAuditLogsQueryKey,
  useGetAuditPurgeHistory,
  usePurgeAuditLogs,
  getGetAuditPurgeHistoryQueryKey,
  useGetSettings,
  useUpdateSettings,
  getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { AuditLog, ListAuditLogsParams } from "@workspace/api-client-react";
import {
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Download,
  Users,
  LayoutList,
  Repeat,
  FileText,
  CreditCard,
  LifeBuoy,
  MessageSquare,
  Server,
  Network,
  UserCog,
  Trash2,
  History,
  Link2,
  Check,
  Plus,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";

const ENTITY_TYPES = [
  "customer",
  "plan",
  "subscription",
  "invoice",
  "payment",
  "ticket",
  "ticket_reply",
  "equipment",
  "ip_pool",
  "user",
];

const ACTION_COLORS: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-800 border-emerald-200",
  update: "bg-blue-100 text-blue-800 border-blue-200",
  delete: "bg-red-100 text-red-800 border-red-200",
};

const ACTION_ICONS: Record<string, React.ElementType> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
};

function ActionBadge({ action }: { action: string }) {
  const Icon = ACTION_ICONS[action];
  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1 text-xs capitalize ${ACTION_COLORS[action] ?? ""}`}
    >
      {Icon && <Icon className="w-3 h-3 flex-shrink-0" />}
      {action}
    </Badge>
  );
}

const ENTITY_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  customer:     { label: "Customer",      icon: Users,        color: "text-violet-600" },
  plan:         { label: "Plan",          icon: LayoutList,   color: "text-indigo-600" },
  subscription: { label: "Subscription",  icon: Repeat,       color: "text-blue-600"   },
  invoice:      { label: "Invoice",       icon: FileText,     color: "text-amber-600"  },
  payment:      { label: "Payment",       icon: CreditCard,   color: "text-emerald-600"},
  ticket:       { label: "Ticket",        icon: LifeBuoy,     color: "text-orange-600" },
  ticket_reply: { label: "Ticket Reply",  icon: MessageSquare,color: "text-orange-500" },
  equipment:    { label: "Equipment",     icon: Server,       color: "text-cyan-600"   },
  ip_pool:      { label: "IP Pool",       icon: Network,      color: "text-teal-600"   },
  user:         { label: "User",          icon: UserCog,      color: "text-gray-600"   },
};

function entityLabel(type: string): string {
  return ENTITY_META[type]?.label ?? type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function EntityTypeBadge({ type }: { type: string }) {
  const meta = ENTITY_META[type];
  const Icon = meta?.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${meta?.color ?? "text-gray-500"}`}>
      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
      {entityLabel(type)}
    </span>
  );
}

function dt(iso: string): string {
  return new Date(iso).toLocaleString("en-KE", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

interface DiffViewProps {
  diff: unknown;
}

function DiffView({ diff }: DiffViewProps) {
  if (!diff || typeof diff !== "object") {
    return (
      <p className="text-sm text-gray-400 italic">No diff data recorded.</p>
    );
  }

  const d = diff as Record<string, { before?: unknown; after?: unknown } | unknown>;

  const hasBefore = "before" in d;
  const hasAfter = "after" in d;

  if (hasBefore || hasAfter) {
    const before = (d as { before?: Record<string, unknown>; after?: Record<string, unknown> }).before;
    const after = (d as { before?: Record<string, unknown>; after?: Record<string, unknown> }).after;
    const allKeys = Array.from(
      new Set([
        ...Object.keys(before ?? {}),
        ...Object.keys(after ?? {}),
      ])
    );

    return (
      <div className="space-y-1">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2 border-b border-gray-100">
          <span>Field</span>
          <span className="text-red-600">Before</span>
          <span className="text-emerald-600">After</span>
        </div>
        {allKeys.map((key) => {
          const bVal = before ? JSON.stringify(before[key] ?? null) : "—";
          const aVal = after ? JSON.stringify(after[key] ?? null) : "—";
          const changed = bVal !== aVal;
          return (
            <div
              key={key}
              className={`grid grid-cols-[auto_1fr_1fr] gap-x-4 text-xs py-1.5 rounded px-1 ${
                changed ? "bg-yellow-50" : ""
              }`}
            >
              <span className="font-mono font-medium text-gray-700 min-w-[120px]">
                {key}
              </span>
              <span
                className={`font-mono break-all ${
                  changed ? "text-red-600 line-through opacity-70" : "text-gray-500"
                }`}
              >
                {bVal}
              </span>
              <span
                className={`font-mono break-all ${
                  changed ? "text-emerald-700 font-semibold" : "text-gray-500"
                }`}
              >
                {aVal}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <pre className="text-xs bg-gray-50 border border-gray-100 rounded p-3 overflow-auto max-h-96 whitespace-pre-wrap break-all">
      {JSON.stringify(diff, null, 2)}
    </pre>
  );
}

interface DiffModalProps {
  log: AuditLog | null;
  onClose: () => void;
}

function DiffModal({ log, onClose }: DiffModalProps) {
  if (!log) return null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4 text-blue-500" />
            Change Details
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 font-medium mb-0.5">Timestamp</p>
              <p className="font-mono text-gray-900">{dt(log.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium mb-0.5">User</p>
              <p className="text-gray-900">{log.userEmail ?? log.userId}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium mb-0.5">Action</p>
              <ActionBadge action={log.action} />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium mb-0.5">Entity</p>
              <p className="text-gray-900 flex items-center gap-1 flex-wrap">
                <EntityTypeBadge type={log.entityType} />
                {log.entityId != null && (
                  <span className="text-gray-400 font-mono text-xs">#{log.entityId}</span>
                )}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-2">
              Diff / Payload
            </p>
            <DiffView diff={log.diff} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AdminAuditLogs() {
  const search = useSearch();
  const [, setLocation] = useLocation();

  // Derive all filter values directly from the URL so that browser
  // back/forward navigation automatically restores the correct filter state.
  const searchParams = new URLSearchParams(search);
  const rawEntityType = searchParams.get("entityType") ?? "all";
  const entityTypeFilter = ENTITY_TYPES.includes(rawEntityType) ? rawEntityType : "all";
  const entityIdInput = searchParams.get("entityId") ?? "";
  const rawAction = searchParams.get("action") ?? "all";
  const actionFilter = ["create", "update", "delete"].includes(rawAction) ? rawAction : "all";
  const dateFrom = searchParams.get("from") ?? "";
  const dateTo = searchParams.get("to") ?? "";
  const userSearch = searchParams.get("user") ?? "";

  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retentionEditing, setRetentionEditing] = useState(false);
  const [retentionInput, setRetentionInput] = useState("");
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  function pushFiltersToUrl(
    overrides: {
      entityType?: string;
      entityId?: string;
      action?: string;
      from?: string;
      to?: string;
      user?: string;
    },
    replace = false,
  ) {
    const merged = {
      entityType: overrides.entityType ?? entityTypeFilter,
      entityId: overrides.entityId ?? entityIdInput,
      action: overrides.action ?? actionFilter,
      from: overrides.from ?? dateFrom,
      to: overrides.to ?? dateTo,
      user: overrides.user ?? userSearch,
    };
    const qs = new URLSearchParams();
    if (merged.entityType !== "all") qs.set("entityType", merged.entityType);
    if (merged.entityId.trim() !== "") qs.set("entityId", merged.entityId.trim());
    if (merged.action !== "all") qs.set("action", merged.action);
    if (merged.from) qs.set("from", merged.from);
    if (merged.to) qs.set("to", merged.to);
    if (merged.user.trim() !== "") qs.set("user", merged.user.trim());
    const qs_str = qs.toString();
    setLocation(`/audit-logs${qs_str ? "?" + qs_str : ""}`, { replace });
  }

  // Keep a ref to the latest pushFiltersToUrl to avoid stale closures in the
  // debounced history-commit callback below.
  const pushFiltersToUrlRef = useRef(pushFiltersToUrl);
  pushFiltersToUrlRef.current = pushFiltersToUrl;

  // For text inputs we update the URL with replace:true on every keystroke (so
  // the URL stays in sync without flooding history), then after 600 ms of quiet
  // we push a real history entry so back/forward navigation still works.
  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleHistoryEntry() {
    if (historyDebounceRef.current !== null) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(() => {
      historyDebounceRef.current = null;
      pushFiltersToUrlRef.current({}, false);
    }, 600);
  }
  useEffect(() => () => {
    if (historyDebounceRef.current !== null) clearTimeout(historyDebounceRef.current);
  }, []);

  function handleCopyLink() {
    const url = window.location.href;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const { data: settingsData, isLoading: settingsLoading } = useGetSettings();
  const currentRetentionDays = settingsData?.auditLogRetentionDays ?? null;

  const updateSettingsMutation = useUpdateSettings({
    mutation: {
      onSuccess: (data) => {
        void qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        setRetentionEditing(false);
        setRetentionInput("");
        const days = data.auditLogRetentionDays;
        toast({
          title: "Retention period updated",
          description: days
            ? `Audit logs older than ${days} days will be removed on the next purge.`
            : "Retention period cleared.",
        });
      },
      onError: () => {
        toast({
          title: "Failed to update retention",
          description: "Could not save the retention period. Please try again.",
          variant: "destructive",
        });
      },
    },
  });

  function handleRetentionSave() {
    const trimmed = retentionInput.trim();
    const num = parseInt(trimmed, 10);
    if (trimmed === "" || isNaN(num) || num < 1) {
      toast({
        title: "Invalid value",
        description: "Please enter a positive number of days.",
        variant: "destructive",
      });
      return;
    }
    updateSettingsMutation.mutate({ data: { auditLogRetentionDays: String(num) } });
  }

  function handleRetentionEdit() {
    setRetentionInput(currentRetentionDays ?? "");
    setRetentionEditing(true);
  }

  function handleRetentionCancel() {
    setRetentionEditing(false);
    setRetentionInput("");
  }

  const { isOwner } = useCurrentUser();
  const { data: purgeHistoryData, isLoading: purgeHistoryLoading } = useGetAuditPurgeHistory({
    query: { queryKey: getGetAuditPurgeHistoryQueryKey(), enabled: isOwner },
  });
  const purgeMutation = usePurgeAuditLogs({
    mutation: {
      onSuccess: (data) => {
        const count = data.deleted;
        toast({
          title: "Purge complete",
          description: `${count} record${count !== 1 ? "s" : ""} deleted.`,
        });
        void qc.invalidateQueries({ queryKey: getGetAuditPurgeHistoryQueryKey() });
        void qc.invalidateQueries({ queryKey: getListAuditLogsQueryKey() });
      },
      onError: () => {
        toast({
          title: "Purge failed",
          description: "An error occurred while purging audit logs.",
          variant: "destructive",
        });
      },
    },
  });

  const purgeHistory = purgeHistoryData?.data ?? [];
  const lastPurge = purgeHistory[0] ?? null;

  const entityIdNum = entityIdInput.trim() !== "" && /^\d+$/.test(entityIdInput.trim())
    ? parseInt(entityIdInput.trim(), 10)
    : undefined;

  const params: ListAuditLogsParams = {
    page,
    limit: 50,
    ...(entityTypeFilter !== "all" ? { entityType: entityTypeFilter } : {}),
    ...(actionFilter !== "all" ? { action: actionFilter as "create" | "update" | "delete" } : {}),
    ...(dateFrom ? { from: dateFrom } : {}),
    ...(dateTo ? { to: dateTo + "T23:59:59Z" } : {}),
    ...(entityIdNum !== undefined ? { entityId: entityIdNum } : {}),
  };

  const { data, isLoading, isError } = useListAuditLogs(params);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      if (entityTypeFilter !== "all") qs.set("entityType", entityTypeFilter);
      if (actionFilter !== "all") qs.set("action", actionFilter);
      if (dateFrom) qs.set("from", dateFrom);
      if (dateTo) qs.set("to", dateTo + "T23:59:59Z");
      if (userSearch.trim()) qs.set("userEmail", userSearch.trim());
      if (entityIdNum !== undefined) qs.set("entityId", String(entityIdNum));
      const url = `/api/audit-logs/export.csv${qs.size > 0 ? "?" + qs.toString() : ""}`;
      const resp = await fetch(url, { credentials: "include" });
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const blob = await resp.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } finally {
      setExporting(false);
    }
  }

  const logs: AuditLog[] = data?.data ?? [];
  const totalPage = data ? Math.max(1, Math.ceil(logs.length / 50) + (logs.length === 50 ? 1 : 0)) : 1;

  const filteredLogs = userSearch.trim()
    ? logs.filter(
        (l) =>
          l.userEmail?.toLowerCase().includes(userSearch.toLowerCase()) ||
          l.userId.toLowerCase().includes(userSearch.toLowerCase())
      )
    : logs;

  function resetFilters() {
    setPage(1);
    setLocation("/audit-logs", { replace: true });
    void qc.invalidateQueries({ queryKey: getListAuditLogsQueryKey() });
  }

  const hasFilters =
    entityTypeFilter !== "all" ||
    actionFilter !== "all" ||
    dateFrom ||
    dateTo ||
    userSearch ||
    entityIdInput.trim() !== "";

  return (
    <div className="space-y-6">
      <DiffModal log={selectedLog} onClose={() => setSelectedLog(null)} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-blue-600" /> Audit Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track every change made by staff — who did what, and when.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="gap-2"
            title="Copy a shareable link to the current filtered view"
          >
            {copied ? (
              <><Check className="w-4 h-4 text-emerald-600" /> Copied!</>
            ) : (
              <><Link2 className="w-4 h-4" /> Copy link</>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={exporting}
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            className="gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {hasFilters ? "Clear filters" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <History className="w-4.5 h-4.5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">Retention &amp; Purge</p>

              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-gray-500">Retention period:</span>
                {retentionEditing ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={1}
                        className="h-7 w-20 text-xs px-2"
                        value={retentionInput}
                        onChange={(e) => setRetentionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRetentionSave();
                          if (e.key === "Escape") handleRetentionCancel();
                        }}
                        autoFocus
                        placeholder="e.g. 90"
                      />
                      <span className="text-xs text-gray-500">days</span>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs px-3 gap-1"
                      onClick={handleRetentionSave}
                      disabled={updateSettingsMutation.isPending}
                    >
                      <Check className="w-3 h-3" />
                      {updateSettingsMutation.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-2 text-gray-500"
                      onClick={handleRetentionCancel}
                      disabled={updateSettingsMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </>
                ) : settingsLoading ? (
                  <Skeleton className="h-4 w-16" />
                ) : (
                  <>
                    <span className="text-xs font-semibold text-gray-800">
                      {currentRetentionDays ? `${currentRetentionDays} days` : "Not set"}
                    </span>
                    <button
                      className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                      onClick={handleRetentionEdit}
                      title="Edit retention period"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                  </>
                )}
              </div>

              {purgeHistoryLoading ? (
                <Skeleton className="h-4 w-48 mt-1.5" />
              ) : lastPurge ? (
                <p className="text-xs text-gray-500 mt-1.5">
                  Last purge:{" "}
                  <span className="font-medium text-gray-700">
                    {new Date(lastPurge.purgedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                  {" · "}
                  <span className={lastPurge.deletedCount > 0 ? "text-red-600 font-medium" : "text-gray-500"}>
                    {lastPurge.deletedCount} record{lastPurge.deletedCount !== 1 ? "s" : ""} removed
                  </span>
                  {" · "}
                  <span className="capitalize text-gray-400">{lastPurge.triggeredBy}</span>
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-1.5">No purge runs recorded yet.</p>
              )}
              {purgeHistory.length > 1 && (
                <details className="mt-2">
                  <summary className="text-xs text-blue-500 cursor-pointer hover:text-blue-700">
                    View last {purgeHistory.length} runs
                  </summary>
                  <div className="mt-2 space-y-1">
                    {purgeHistory.map((run) => (
                      <div key={run.id} className="flex items-center gap-3 text-xs text-gray-500">
                        <span className="font-mono text-gray-600 min-w-[140px]">
                          {new Date(run.purgedAt).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                        <span className={run.deletedCount > 0 ? "text-red-500 font-medium" : ""}>
                          {run.deletedCount} deleted
                        </span>
                        <span className="capitalize text-gray-400">{run.triggeredBy}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 gap-2 text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setPurgeConfirmOpen(true)}
              disabled={purgeMutation.isPending}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {purgeMutation.isPending ? "Purging…" : "Purge Now"}
            </Button>
          )}

          <Dialog open={purgeConfirmOpen} onOpenChange={setPurgeConfirmOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-red-600">
                  <Trash2 className="w-4 h-4" />
                  Confirm Purge
                </DialogTitle>
                <DialogDescription className="pt-1 space-y-2">
                  <span className="block">
                    This will permanently delete all audit log records older than{" "}
                    {currentRetentionDays
                      ? <strong>{currentRetentionDays} days</strong>
                      : <strong>the configured retention period</strong>
                    }.
                  </span>
                  <span className="block font-semibold text-red-600">
                    This action cannot be undone.
                  </span>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="ghost"
                  onClick={() => setPurgeConfirmOpen(false)}
                  disabled={purgeMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="gap-2"
                  disabled={purgeMutation.isPending}
                  onClick={() => {
                    setPurgeConfirmOpen(false);
                    purgeMutation.mutate();
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {purgeMutation.isPending ? "Purging…" : "Yes, purge now"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4 text-sm font-medium text-gray-700">
          <Filter className="w-4 h-4 text-gray-400" /> Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              className="pl-9 h-9 text-sm"
              placeholder="User email…"
              value={userSearch}
              onChange={(e) => {
                setPage(1);
                pushFiltersToUrl({ user: e.target.value }, true);
                scheduleHistoryEntry();
              }}
            />
          </div>

          <Select
            value={entityTypeFilter}
            onValueChange={(v) => { setPage(1); pushFiltersToUrl({ entityType: v }); }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Entity type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entity types</SelectItem>
              {ENTITY_TYPES.map((t) => {
                const meta = ENTITY_META[t];
                const Icon = meta?.icon;
                return (
                  <SelectItem key={t} value={t}>
                    <span className={`inline-flex items-center gap-1.5 ${meta?.color ?? "text-gray-500"}`}>
                      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
                      {entityLabel(t)}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Input
            type="number"
            min={1}
            className="h-9 text-sm"
            placeholder="Entity ID…"
            value={entityIdInput}
            onChange={(e) => { setPage(1); pushFiltersToUrl({ entityId: e.target.value }, true); scheduleHistoryEntry(); }}
          />

          <Select
            value={actionFilter}
            onValueChange={(v) => { setPage(1); pushFiltersToUrl({ action: v }); }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              <SelectItem value="create">Create</SelectItem>
              <SelectItem value="update">Update</SelectItem>
              <SelectItem value="delete">Delete</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-2">
            <Input
              type="date"
              className="h-9 text-sm"
              value={dateFrom}
              onChange={(e) => { setPage(1); pushFiltersToUrl({ from: e.target.value }); }}
              title="From date"
            />
            <Input
              type="date"
              className="h-9 text-sm"
              value={dateTo}
              onChange={(e) => { setPage(1); pushFiltersToUrl({ to: e.target.value }); }}
              title="To date"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-12 text-center text-sm text-red-500">
            Failed to load audit logs. You may not have permission to view this page.
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            No audit records match your filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Timestamp</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Entity Type</th>
                    <th className="px-4 py-3 font-medium">Entity ID</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log, i) => (
                    <tr
                      key={log.id}
                      className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors cursor-pointer ${
                        i % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                      }`}
                      onClick={() => setSelectedLog(log)}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                        {dt(log.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">
                        {log.userEmail ?? (
                          <span className="text-gray-400 font-mono text-xs">
                            {log.userId.slice(0, 12)}…
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={log.action} />
                      </td>
                      <td className="px-4 py-3">
                        <EntityTypeBadge type={log.entityType} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {log.entityId != null ? `#${log.entityId}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 ml-auto"
                          onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }}
                        >
                          View diff <ChevronRightIcon className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
              <span>
                Showing {filteredLogs.length} record{filteredLogs.length !== 1 ? "s" : ""}
                {filteredLogs.length < logs.length && (
                  <> (filtered from {logs.length})</>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs">Page {page}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logs.length < 50}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StaffAuditExport({ userId }: { userId?: string }) {
  const [exporting, setExporting] = useState(false);
  const canExport = Boolean(userId);

  async function handleExportCsv() {
    if (!userId) return;

    setExporting(true);
    try {
      const qs = new URLSearchParams({ userId });
      const resp = await fetch(`/api/audit-logs/export.csv?${qs.toString()}`, {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);

      const blob = await resp.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `my-audit-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-blue-600" /> My Audit Activity
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Download a CSV of the actions recorded under your account.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-gray-900">Export my activity</h2>
          <p className="text-sm text-gray-500 mt-1">
            This download is restricted to your own audit records.
          </p>
        </div>
        {!canExport && (
          <p className="text-sm text-red-600">
            Your account details are still loading. Refresh and try again.
          </p>
        )}
        <Button
          onClick={handleExportCsv}
          disabled={exporting || !canExport}
          className="gap-2"
        >
          <Download className="w-4 h-4" />
          {exporting ? "Preparing download…" : "Download my activity"}
        </Button>
      </div>
    </div>
  );
}

export default function AuditLogs() {
  const currentUser = useCurrentUser();

  if (currentUser.isAdmin || currentUser.isOwner) {
    return <AdminAuditLogs />;
  }

  return <StaffAuditExport userId={currentUser.id} />;
}
