import { Router } from "express";
import { execSync, spawn } from "child_process";
import { requireRole } from "../middlewares/requireRole";

const router = Router();

function gitExec(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", timeout: 15_000 }).trim();
  } catch {
    return "";
  }
}

// ── GET /api/system/version ──────────────────────────────────────────────────
router.get("/api/system/version", async (req, res) => {
  const APP_DIR = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";
  const isProduction = process.env["NODE_ENV"] === "production";

  const localCommit  = gitExec("git rev-parse HEAD", APP_DIR);
  const shortCommit  = localCommit ? localCommit.slice(0, 7) : "unknown";
  const branch       = gitExec("git rev-parse --abbrev-ref HEAD", APP_DIR);
  const commitMsg    = gitExec("git log -1 --format=%s", APP_DIR);
  const commitDate   = gitExec("git log -1 --format=%ai", APP_DIR);
  const remoteCommit = gitExec("git rev-parse origin/main 2>/dev/null || true", APP_DIR);
  const updateAvailable = !!(remoteCommit && localCommit && remoteCommit !== localCommit);

  return res.json({
    version:         "1.0.0",
    commit:          shortCommit,
    commitFull:      localCommit,
    branch:          branch || "main",
    commitMessage:   commitMsg,
    commitDate:      commitDate,
    updateAvailable,
    remoteCommit:    remoteCommit ? remoteCommit.slice(0, 7) : null,
    isProduction,
    appDir:          APP_DIR,
  });
});

// ── POST /api/system/update — admin only, streams live output via SSE ────────
router.post("/api/system/update", requireRole("admin"), (req, res) => {
  const APP_DIR = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";
  const UPDATE_SCRIPT = `${APP_DIR}/deploy/update.sh`;

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type: "log" | "done" | "error", data: string) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("log", `Starting update from ${APP_DIR}…`);

  const child = spawn("bash", [UPDATE_SCRIPT], {
    cwd: APP_DIR,
    env: { ...process.env },
  });

  child.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) send("log", line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) send("log", line);
    }
  });

  child.on("close", (code) => {
    if (code === 0) {
      send("done", "Update complete ✓ — server is restarting, refresh in 15 seconds.");
    } else {
      send("error", `Update script exited with code ${code ?? "unknown"}. Check server logs.`);
    }
    res.end();
  });

  child.on("error", (err) => {
    if (err.message.includes("ENOENT")) {
      send("error", `Update script not found at ${UPDATE_SCRIPT}. This feature works on the installed Ubuntu server, not in the Replit dev environment.`);
    } else {
      send("error", err.message);
    }
    res.end();
  });

  req.on("close", () => { child.kill(); });
});

export default router;
