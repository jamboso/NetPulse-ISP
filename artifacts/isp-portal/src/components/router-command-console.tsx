import { useEffect, useRef, useState } from "react";
import { Terminal, Send, XCircle, Trash2, Loader2, ShieldCheck } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ConsoleLine = {
  id: number;
  stream: "command" | "stdout" | "stderr" | "system";
  text: string;
};

export function RouterCommandConsole({
  routerId,
  routerName,
  vpnConnected,
  sshHostKey,
}: {
  routerId: number;
  routerName: string;
  vpnConnected: boolean;
  sshHostKey?: string | null;
}) {
  const { isAdmin, isOwner } = useCurrentUser();
  const canUseConsole = isAdmin || isOwner;
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostKeyOpen, setHostKeyOpen] = useState(false);
  const [trustedHostKey, setTrustedHostKey] = useState(sshHostKey ?? null);
  const [observedHostKey, setObservedHostKey] = useState<string | null>(null);
  const [hostKeyLoading, setHostKeyLoading] = useState(false);
  const [hostKeyError, setHostKeyError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const outputEnd = useRef<HTMLDivElement | null>(null);

  const addLine = (stream: ConsoleLine["stream"], text: string) => {
    if (!text) return;
    setLines((current) => [...current, { id: Date.now() + current.length, stream, text }]);
  };

  const closeConsole = () => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setOpen(false);
  };

  useEffect(() => {
    outputEnd.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => setTrustedHostKey(sshHostKey ?? null), [sshHostKey]);

  const readHostKey = async () => {
    setHostKeyLoading(true);
    setHostKeyError(null);
    try {
      const response = await fetch(`/api/routers/${routerId}/console/host-key`, {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not read the router SSH host key.");
      setObservedHostKey(body?.fingerprint ?? null);
    } catch (err) {
      setHostKeyError((err as Error).message);
    } finally {
      setHostKeyLoading(false);
    }
  };

  const openHostKeyEnrollment = () => {
    setObservedHostKey(null);
    setHostKeyOpen(true);
    void readHostKey();
  };

  const trustHostKey = async () => {
    if (!observedHostKey) return;
    setHostKeyLoading(true);
    setHostKeyError(null);
    try {
      const response = await fetch(`/api/routers/${routerId}/console/host-key/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: observedHostKey }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not verify the router SSH host key.");
      setTrustedHostKey(body?.fingerprint ?? observedHostKey);
      setHostKeyOpen(false);
    } catch (err) {
      setHostKeyError((err as Error).message);
    } finally {
      setHostKeyLoading(false);
    }
  };

  const runCommand = async () => {
    const value = command.trim();
    if (!value || running) return;
    setError(null);
    addLine("command", `$ ${value}`);
    setCommand("");
    setRunning(true);
    const activeController = new AbortController();
    controller.current = activeController;

    try {
      const response = await fetch(`/api/routers/${routerId}/console/command`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: value }),
        signal: activeController.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? `Console request failed (${response.status}).`);
      }
      if (!response.body) throw new Error("Console stream was unavailable.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.replace(/^data:\s*/, "");
          if (!data) continue;
          const event = JSON.parse(data) as { type: string; text?: string; stream?: "stdout" | "stderr"; message?: string; exitCode?: number | null; host?: string; port?: number };
          if (event.type === "output" && event.text && event.stream) addLine(event.stream, event.text);
          if (event.type === "connected") addLine("system", `Connected through the management VPN (${event.host}:${event.port}).`);
          if (event.type === "complete") addLine("system", `Command finished${event.exitCode == null ? "" : ` with exit code ${event.exitCode}`}.`);
          if (event.type === "error") setError(event.message ?? "Console command failed.");
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (controller.current === activeController) controller.current = null;
      setRunning(false);
    }
  };

  const unavailableReason = !canUseConsole
    ? "Only administrators and owners can use the router command console."
    : !vpnConnected
      ? "Connect the router’s private management VPN before opening the console."
      : undefined;
  const keyEnrollmentReason = !trustedHostKey ? "Verify this router’s SSH host key before using the console." : undefined;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50"
        disabled={Boolean(unavailableReason)}
        title={unavailableReason ?? keyEnrollmentReason ?? "Open command console"}
        onClick={() => trustedHostKey ? setOpen(true) : openHostKeyEnrollment()}
      >
        {trustedHostKey || !vpnConnected ? <Terminal className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
        {!vpnConnected ? "Command Console" : trustedHostKey ? "Command Console" : "Verify Router Key"}
      </Button>
      <Dialog open={hostKeyOpen} onOpenChange={setHostKeyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700" /> Verify {routerName}</DialogTitle>
            <DialogDescription>
              The console will not send router credentials until this SSH host key has been verified and trusted.
            </DialogDescription>
          </DialogHeader>
          {hostKeyLoading ? (
            <div className="flex items-center gap-2 py-5 text-sm text-gray-600"><Loader2 className="h-4 w-4 animate-spin" /> Reading SSH identity…</div>
          ) : observedHostKey ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">Confirm this fingerprint matches the router you selected:</p>
              <code className="block break-all rounded-md bg-slate-950 p-3 text-xs text-emerald-300">{observedHostKey}</code>
              <p className="text-xs text-gray-500">A second check must match before NetPulse stores this key.</p>
            </div>
          ) : null}
          {hostKeyError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{hostKeyError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setHostKeyOpen(false)} disabled={hostKeyLoading}>Cancel</Button>
            {observedHostKey && <Button type="button" onClick={() => void trustHostKey()} disabled={hostKeyLoading}>Trust router key</Button>}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : closeConsole())}>
        <DialogContent className="max-w-3xl gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-slate-700" />
              {routerName} command console
            </DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-xs text-gray-500">
            Commands run over the router’s private management VPN and require its verified SSH host key. Output and command text are not stored in the audit log.
          </DialogDescription>
          <div className="h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs leading-5">
            {lines.length === 0 ? (
              <p className="text-slate-400">Ready. Enter a RouterOS command below.</p>
            ) : lines.map((line) => (
              <pre
                key={line.id}
                className={line.stream === "command"
                  ? "whitespace-pre-wrap text-emerald-300"
                  : line.stream === "stderr"
                    ? "whitespace-pre-wrap text-amber-300"
                    : line.stream === "system"
                      ? "whitespace-pre-wrap text-sky-300"
                      : "whitespace-pre-wrap text-slate-100"}
              >
                {line.text}
              </pre>
            ))}
            <div ref={outputEnd} />
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <XCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void runCommand();
                }
              }}
              placeholder="/system resource print"
              disabled={running}
              aria-label="RouterOS command"
              className="font-mono"
            />
            <Button type="button" onClick={() => void runCommand()} disabled={running || !command.trim()} className="gap-1.5">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Run
            </Button>
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setLines([]); setError(null); }} disabled={running} className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={closeConsole}>Close console</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}