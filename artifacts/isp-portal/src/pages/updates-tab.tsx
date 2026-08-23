import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpCircle, CheckCircle2, Download, GitBranch, Hash, Info, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";

type DeploymentState =
  | "idle" | "preflight" | "backing-up" | "updating" | "installing" | "building"
  | "migrating" | "restarting" | "health-check" | "succeeded" | "failed" | "no-update";

interface DeploymentStatus {
  state: DeploymentState;
  phase: string;
  message: string;
  targetCommit?: string;
  previousCommit?: string;
  backupPath?: string;
  updatedAt?: string;
}

interface VersionInfo {
  commit: string;
  commitFull: string;
  branch: string;
  candidateCommit: string;
  remoteCommit: string;
  candidateMessage: string;
  candidateDate: string;
  updateAvailable: boolean;
  status: "up-to-date" | "update-available" | "retry-available";
  isProduction: boolean;
  deployment: DeploymentStatus;
}

function LogLine({ line }: { line: string }) {
  const clean = line.replace(/\x1B\[[0-9;]*m/g, "");
  const isError = /error|fail|refus|stopped/i.test(clean);
  const isOk = /✓|success|complete|healthy|passed/i.test(clean);
  return <div className={`font-mono text-xs leading-5 ${isError ? "text-red-400" : isOk ? "text-green-400" : "text-gray-300"}`}>{clean}</div>;
}

function isActiveDeployment(state: DeploymentState | undefined): boolean {
  return state != null && !["idle", "succeeded", "failed", "no-update"].includes(state);
}

export function UpdatesTab() {
  const currentUser = useCurrentUser();
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deployment, setDeployment] = useState<DeploymentStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const fetchVersion = async () => {
    if (!currentUser.isOwner) return;
    setChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/system/version", { credentials: "include" });
      const data = await response.json() as VersionInfo | { message?: string };
      if (!response.ok) throw new Error("message" in data ? data.message ?? "Update preflight failed." : "Update preflight failed.");
      setVersion(data as VersionInfo);
      setDeployment((data as VersionInfo).deployment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the configured production branch.");
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const response = await fetch("/api/system/update/status", { credentials: "include" });
      if (!response.ok) return;
      const data = await response.json() as DeploymentStatus;
      setDeployment(data);
      if (!isActiveDeployment(data.state)) {
        setUpdating(false);
        if (data.state === "succeeded" || data.state === "no-update") void fetchVersion();
      }
    } catch {
      // A restart temporarily interrupts polling; the next interval reconnects.
    }
  };

  useEffect(() => {
    if (currentUser.isOwner) void fetchVersion();
    else setLoading(false);
  // Session role changes are the only dependency that should retrigger discovery.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.isOwner]);

  useEffect(() => {
    if (!updating && !isActiveDeployment(deployment?.state)) return;
    const timer = window.setInterval(() => void fetchStatus(), 3_000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updating, deployment?.state]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const runUpdate = async () => {
    if (!version?.candidateCommit) return;
    setConfirmOpen(false);
    setConfirmation("");
    setError(null);
    setLogs([]);
    setUpdating(true);
    setDeployment({
      state: "preflight",
      phase: "preflight",
      message: `Starting deployment of ${version.remoteCommit}.`,
      targetCommit: version.candidateCommit,
    });

    try {
      const response = await fetch("/api/system/update", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCommit: version.candidateCommit, confirmation: version.candidateCommit }),
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
        throw new Error(body.error ?? "Deployment could not start.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = block.match(/^event: (.+)$/m)?.[1] ?? "log";
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (!data) continue;
          const message = JSON.parse(data) as string;
          setLogs((previous) => [...previous, message]);
          if (event === "error") setError(message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment connection ended unexpectedly.");
    } finally {
      // PM2 intentionally ends the SSE connection while the health check runs.
      // Status polling reconnects after the service is back.
      void fetchStatus();
    }
  };

  if (!currentUser.isOwner) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600">
        Production release controls are available only to the platform owner.
      </div>
    );
  }

  const targetMatches = confirmation.trim().toLowerCase() === version?.candidateCommit.toLowerCase();
  const active = updating || isActiveDeployment(deployment?.state);

  return (
    <div className="space-y-5">
      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div><p className="font-medium">Reviewed GitHub releases only</p><p>Check now only reads the configured tracked branch. Only commits already on that branch can be deployed.</p></div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-3.5">
          <GitBranch className="h-4 w-4 text-blue-600" />
          <h3 className="flex-1 text-sm font-semibold text-gray-800">Configured production release</h3>
          <Button variant="ghost" size="sm" onClick={() => void fetchVersion()} disabled={checking || active} className="gap-1.5 text-xs text-gray-600">
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check now
          </Button>
        </div>
        {loading ? <div className="flex items-center justify-center gap-2 p-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking release…</div> : error && !version ? (
          <div className="m-5 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
            <div className="flex gap-2"><Hash className="mt-0.5 h-4 w-4 text-gray-400" /><div><p className="text-xs text-gray-400">Deployed commit</p><p className="font-mono text-sm font-medium text-gray-800">{version?.commit ?? "—"}</p></div></div>
            <div className="flex gap-2"><GitBranch className="mt-0.5 h-4 w-4 text-gray-400" /><div><p className="text-xs text-gray-400">Tracked branch</p><p className="font-mono text-sm text-gray-800">{version?.branch ?? "—"}</p></div></div>
            <div className="flex gap-2"><ArrowUpCircle className="mt-0.5 h-4 w-4 text-gray-400" /><div><p className="text-xs text-gray-400">Release status</p>{version?.updateAvailable ? <Badge variant="outline" className="mt-0.5 border-amber-200 bg-amber-50 text-xs text-amber-700">Update available: {version.remoteCommit}</Badge> : <Badge variant="outline" className="mt-0.5 border-green-200 bg-green-50 text-xs text-green-700">Up to date</Badge>}</div></div>
            {version?.updateAvailable && <div className="sm:col-span-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700"><span className="font-medium">Candidate {version.remoteCommit}:</span> {version.candidateMessage}</div>}
          </div>
        )}
        {!version?.isProduction && <div className="mx-5 mb-5 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700"><Info className="h-3.5 w-3.5 shrink-0" />This is a development environment. Deployment remains disabled.</div>}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-5 py-3.5"><Download className="h-4 w-4 text-blue-600" /><h3 className="flex-1 text-sm font-semibold text-gray-800">Deploy verified release</h3>{deployment?.state === "succeeded" && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />Healthy</span>}{deployment?.state === "failed" && <span className="flex items-center gap-1 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5" />Stopped safely</span>}</div>
        <div className="space-y-3 p-5">
          <p className="text-sm text-gray-600">The release is backed up, built, and migrated before PM2 is restarted. A failed preflight, build, or migration leaves the running service in place.</p>
          <Button onClick={() => setConfirmOpen(true)} disabled={!version?.isProduction || !version?.updateAvailable || active} className="gap-2 bg-blue-600 text-white hover:bg-blue-700">
            {active ? <><Loader2 className="h-4 w-4 animate-spin" /> {deployment?.phase ?? "Deploying"}…</> : <><Download className="h-4 w-4" /> Deploy update</>}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {deployment && deployment.state !== "idle" && <div className={`rounded-md border p-3 text-sm ${deployment.state === "failed" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}><p className="font-medium capitalize">{deployment.phase.replace(/-/g, " ")}</p><p>{deployment.message}</p>{(deployment.previousCommit || deployment.backupPath) && <p className="mt-2 font-mono text-xs">Previous release: {deployment.previousCommit?.slice(0, 7) ?? "—"}{deployment.backupPath ? ` · Backup: ${deployment.backupPath}` : ""}</p>}</div>}
        </div>
        {logs.length > 0 && <div ref={logRef} className="mx-5 mb-5 h-64 space-y-0.5 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-4">{logs.map((line, index) => <LogLine key={`${index}-${line}`} line={line} />)}</div>}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm production deployment</AlertDialogTitle>
            <AlertDialogDescription>Type the full target commit below to deploy only this reviewed GitHub release. The portal will re-check the branch immediately before starting.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2"><p className="break-all rounded bg-gray-100 p-2 font-mono text-xs text-gray-800">{version?.candidateCommit}</p><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Paste the full target commit" aria-label="Target commit confirmation" /></div>
          <AlertDialogFooter><AlertDialogCancel onClick={() => setConfirmation("")}>Cancel</AlertDialogCancel><AlertDialogAction onClick={runUpdate} disabled={!targetMatches} className="bg-blue-600 hover:bg-blue-700">Deploy {version?.remoteCommit}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}