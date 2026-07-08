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
router.get("/system/version", async (req, res) => {
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
router.post("/system/update", requireRole("admin"), (req, res) => {
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

  // Detach the child so it survives when pm2 restarts this Node process
  // mid-update (the restart step kills the parent, but the bash script
  // should keep running to completion).
  const child = spawn("bash", [UPDATE_SCRIPT], {
    cwd: APP_DIR,
    env: { ...process.env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref();

  let doneSent = false;

  const finish = (type: "done" | "error", msg: string) => {
    if (doneSent) return;
    doneSent = true;
    send(type, msg);
    res.end();
  };

  child.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      // Sentinel printed by update.sh just before pm2 restart — send the
      // "done" event NOW so the browser receives it before the Node process
      // is killed by pm2.
      if (line.includes("NETPULSE_RESTART_NOW")) {
        finish("done", "Update complete ✓ — server is restarting, refresh in 20 seconds.");
        return;
      }
      send("log", line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n");
    for (const line of lines) {
      if (line.trim()) send("log", line);
    }
  });

  child.on("close", (code) => {
    if (doneSent) return;
    if (code === 0) {
      finish("done", "Update complete ✓ — server is restarting, refresh in 20 seconds.");
    } else {
      finish("error", `Update script exited with code ${code ?? "unknown"}. Check server logs.`);
    }
  });

  child.on("error", (err) => {
    if (err.message.includes("ENOENT")) {
      finish("error", `Update script not found at ${UPDATE_SCRIPT}. This feature works on the installed Ubuntu server, not in the Replit dev environment.`);
    } else {
      finish("error", err.message);
    }
  });

  // Only kill child if done hasn't been sent yet (i.e. user cancelled early)
  req.on("close", () => { if (!doneSent) child.kill(); });
});

export default router;
