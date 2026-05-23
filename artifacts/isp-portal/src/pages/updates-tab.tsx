import { useState, useEffect, useRef } from "react";
import { GitBranch, RefreshCw, Download, CheckCircle2, AlertCircle, Loader2, Cpu, Clock, Hash, ArrowUpCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface VersionInfo {
  version: string;
  commit: string;
  commitFull: string;
  branch: string;
  commitMessage: string;
  commitDate: string;
  updateAvailable: boolean;
  remoteCommit: string | null;
  isProduction: boolean;
  appDir: string;
}

function LogLine({ line }: { line: string }) {
  const clean = line.replace(/\x1B\[[0-9;]*m/g, "");
  const isOk    = /✓|✔|OK|complete|ready|up to date/i.test(clean);
  const isWarn  = /⚠|warn/i.test(clean);
  const isErr   = /✗|error|fail|FAIL/i.test(clean) && !/no changes/i.test(clean);
  const isStep  = /^──|^\[/.test(clean.trim());
  return (
    <div className={`font-mono text-xs leading-5 ${
      isErr  ? "text-red-400" :
      isOk   ? "text-green-400" :
      isWarn ? "text-yellow-400" :
      isStep ? "text-blue-300 font-semibold mt-1" :
               "text-gray-300"
    }`}>
      {clean}
    </div>
  );
}

export function UpdatesTab() {
  const [version, setVersion]   = useState<VersionInfo | null>(null);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState(false);
  const [logs, setLogs]         = useState<string[]>([]);
  const [status, setStatus]     = useState<"idle" | "running" | "done" | "error">("idle");
  const [checking, setChecking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchVersion = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/system/version");
      const data = await res.json() as VersionInfo;
      setVersion(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => { void fetchVersion(); }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const runUpdate = async () => {
    setLogs([]);
    setStatus("running");
    setUpdating(true);

    try {
      const response = await fetch("/api/system/update", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok || !response.body) {
        const txt = await response.text().catch(() => response.statusText);
        throw new Error(`Server returned ${response.status}: ${txt}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const processChunk = (chunk: string) => {
        buf += chunk;
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          let eventType = "log";
          let dataLine = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLine = line.slice(6);
          }
          if (!dataLine) continue;
          const msg = JSON.parse(dataLine) as string;
          if (eventType === "done") {
            setLogs((prev) => [...prev, msg]);
            setStatus("done");
            setUpdating(false);
            setTimeout(() => void fetchVersion(), 5000);
            return true; // signal stream end
          } else if (eventType === "error") {
            setLogs((prev) => [...prev, `ERROR: ${msg}`]);
            setStatus("error");
            setUpdating(false);
            return true;
          } else {
            setLogs((prev) => [...prev, msg]);
          }
        }
        return false;
      };

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const finished = processChunk(decoder.decode(value, { stream: true }));
        if (finished) break outer;
      }
    } catch (err) {
      setLogs((prev) => [...prev, `ERROR: ${err instanceof Error ? err.message : String(err)}`]);
      setStatus("error");
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading version info…
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex gap-3">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-sm text-blue-700 space-y-1">
          <p className="font-medium">How updates work</p>
          <p>
            Every change you make in Replit is automatically pushed to GitHub.
            Click <strong>Update Now</strong> below to pull the latest code from GitHub
            to this server, rebuild, run migrations, and restart — all in one click.
          </p>
        </div>
      </div>

      {/* ── Current version card ──────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 bg-gray-50 border-b border-gray-200">
          <Cpu className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800 flex-1">Current Version</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchVersion()}
            disabled={checking}
            className="gap-1.5 text-xs text-gray-500"
          >
            {checking
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
            Check now
          </Button>
        </div>

        <div className="px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-3">
          <div className="flex items-start gap-2">
            <Hash className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Commit</p>
              <p className="text-sm font-mono font-medium text-gray-800">
                {version?.commit ?? "—"}
                {version?.updateAvailable && (
                  <span className="ml-2 text-xs font-sans text-amber-600 font-normal">
                    → {version.remoteCommit} available
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <GitBranch className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Branch</p>
              <p className="text-sm font-mono text-gray-800">{version?.branch ?? "—"}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Clock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Last commit</p>
              <p className="text-sm text-gray-800 truncate max-w-xs" title={version?.commitMessage}>
                {version?.commitMessage ?? "—"}
              </p>
              {version?.commitDate && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(version.commitDate).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2">
            <ArrowUpCircle className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Status</p>
              {version?.updateAvailable ? (
                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200 mt-0.5">
                  Update available
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 mt-0.5">
                  Up to date
                </Badge>
              )}
            </div>
          </div>
        </div>

        {!version?.isProduction && (
          <div className="mx-5 mb-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Running in <strong className="mx-1">development mode</strong> (Replit).
            The Update button is only functional on the installed Ubuntu production server.
          </div>
        )}
      </div>

      {/* ── Update button ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 bg-gray-50 border-b border-gray-200">
          <Download className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800 flex-1">Deploy Update</h3>
          {status === "done" && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" /> Success
            </span>
          )}
          {status === "error" && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle className="w-3.5 h-3.5" /> Failed
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-gray-500">
            Pulls the latest code from <strong>GitHub → main</strong>, installs dependencies,
            rebuilds the app, runs database migrations, and restarts the server.
            Takes about <strong>3–5 minutes</strong>.
          </p>

          <Button
            onClick={runUpdate}
            disabled={updating}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {updating
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating…</>
              : <><Download className="w-4 h-4" /> Update Now</>}
          </Button>
        </div>

        {/* Live log output */}
        {logs.length > 0 && (
          <div
            ref={logRef}
            className="mx-5 mb-4 bg-gray-950 rounded-lg p-4 h-72 overflow-y-auto space-y-0.5 border border-gray-800"
          >
            {logs.map((line, i) => <LogLine key={i} line={line} />)}
            {updating && (
              <div className="flex items-center gap-2 text-gray-500 text-xs mt-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Running…
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Manual fallback ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5 bg-gray-50 border-b border-gray-200">
          <GitBranch className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800">Manual update (SSH fallback)</h3>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-gray-500 mb-3">
            If the button above fails, SSH into your server and run:
          </p>
          <pre className="bg-gray-950 text-green-300 text-xs rounded-lg px-4 py-3 font-mono overflow-x-auto">
            sudo bash /opt/netpulse/deploy/update.sh
          </pre>
        </div>
      </div>

    </div>
  );
}
