import { Router } from "express";
import { execFileSync, spawn } from "child_process";
import { readFileSync } from "fs";
import { requireRole } from "../middlewares/requireRole";

const router = Router();
const SAFE_NAME = /^[A-Za-z0-9._/-]+$/;

type ReleaseStatus = {
  branch: string;
  commit: string;
  commitFull: string;
  commitMessage: string;
  commitDate: string;
  remoteCommit: string | null;
  remoteCommitFull: string | null;
  updateAvailable: boolean;
  retryAvailable: boolean;
  isProduction: boolean;
  remote: string | null;
  deployment: {
    state: "running" | "success" | "failed";
    phase: string;
    targetCommit: string;
  } | null;
};

function gitExec(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 }).trim();
  } catch {
    return "";
  }
}

function configuredName(value: string | undefined): string | null {
  const name = value?.trim();
  return name && SAFE_NAME.test(name) ? name : null;
}

function resolveRemote(cwd: string, branch: string): string | null {
  const preferred = configuredName(process.env["NETPULSE_UPDATE_REMOTE"]);
  if (preferred && gitExec(["remote", "get-url", preferred], cwd)) return preferred;

  const tracked = configuredName(gitExec(["config", "--get", `branch.${branch}.remote`], cwd));
  if (tracked && gitExec(["remote", "get-url", tracked], cwd)) return tracked;

  for (const candidate of ["origin", "github"]) {
    if (gitExec(["remote", "get-url", candidate], cwd)) return candidate;
  }

  return null;
}

function deploymentStatus(): ReleaseStatus["deployment"] {
  const statusFile = process.env["NETPULSE_UPDATE_STATUS_FILE"] ?? "/var/lib/netpulse/update-status.json";
  try {
    const parsed = JSON.parse(readFileSync(statusFile, "utf8")) as Record<string, unknown>;
    const state = parsed["state"];
    const phase = parsed["phase"];
    const targetCommit = parsed["targetCommit"];
    if (
      (state === "running" || state === "success" || state === "failed")
      && typeof phase === "string"
      && typeof targetCommit === "string"
    ) {
      if (state === "running") {
        const pid = parsed["pid"];
        const isAlive = typeof pid === "number"
          && Number.isInteger(pid)
          && pid > 0
          && (() => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          })();
        if (!isAlive) {
          return { state: "failed", phase: "interrupted before completion", targetCommit };
        }
      }
      return { state, phase, targetCommit };
    }
  } catch {
    // No previous production deployment status exists yet.
  }
  return null;
}

function releaseStatus(cwd: string, refreshRemote = false): ReleaseStatus {
  const localCommit = gitExec(["rev-parse", "HEAD"], cwd);
  const branch = configuredName(process.env["NETPULSE_UPDATE_BRANCH"])
    ?? configuredName(gitExec(["branch", "--show-current"], cwd))
    ?? "main";
  const remote = resolveRemote(cwd, branch);

  if (refreshRemote && remote && SAFE_NAME.test(branch)) {
    gitExec([
      "fetch",
      "--quiet",
      remote,
      `refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
    ], cwd);
  }

  const remoteCommit = remote
    ? gitExec(["rev-parse", `${remote}/${branch}`], cwd)
    : "";
  const deployment = deploymentStatus();
  const retryAvailable = Boolean(
    deployment?.state === "failed"
    && remoteCommit
    && localCommit
    && deployment.targetCommit === localCommit
    && remoteCommit === localCommit,
  );

  return {
    branch,
    commit: localCommit ? localCommit.slice(0, 7) : "unknown",
    commitFull: localCommit,
    commitMessage: gitExec(["log", "-1", "--format=%s"], cwd),
    commitDate: gitExec(["log", "-1", "--format=%ai"], cwd),
    remoteCommit: remoteCommit ? remoteCommit.slice(0, 7) : null,
    remoteCommitFull: remoteCommit || null,
    updateAvailable: Boolean(remoteCommit && localCommit && remoteCommit !== localCommit),
    retryAvailable,
    isProduction: process.env["NODE_ENV"] === "production",
    remote,
    deployment,
  };
}

// Deployment controls reveal production release metadata and are deliberately
// restricted to the platform owner. An admin may manage a tenant, but must not
// be able to run arbitrary production code from the configured Git remote.
router.get("/system/version", requireRole("owner"), (_req, res) => {
  const appDir = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";
  const status = releaseStatus(appDir, true);
  return res.json({ version: "1.0.0", ...status });
});

// POST /api/system/update — owner only, streams update output via SSE.
router.post("/system/update", requireRole("owner"), (req, res): void => {
  const appDir = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";
  const status = releaseStatus(appDir, true);
  const targetCommit = typeof req.body?.targetCommit === "string"
    ? req.body.targetCommit
    : "";

  if (!status.isProduction) {
    res.status(400).json({ error: "Updates can only run on the installed Ubuntu server." });
    return;
  }
  if (!status.remote || !status.remoteCommitFull) {
    res.status(409).json({ error: "No configured Git remote release was found. Check the server Git configuration." });
    return;
  }
  if (status.deployment?.state === "running") {
    res.status(409).json({ error: "An update is already in progress. Wait for it to finish before starting another." });
    return;
  }
  if (!status.updateAvailable && !status.retryAvailable) {
    res.status(409).json({ error: "The server is already up to date." });
    return;
  }
  if (targetCommit !== status.remoteCommitFull) {
    res.status(409).json({ error: "The available release changed. Check for updates again before deploying." });
    return;
  }

  const updateScript = `${appDir}/deploy/update.sh`;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type: "log" | "restarting" | "done" | "error", data: string) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send(
    "log",
    status.retryAvailable
      ? `Retrying incomplete release ${status.remoteCommit} from ${status.branch}…`
      : `Preparing release ${status.remoteCommit} from ${status.branch}…`,
  );

  const child = spawn("bash", [updateScript], {
    cwd: appDir,
    env: {
      ...process.env,
      NETPULSE_EXPECTED_COMMIT: status.remoteCommitFull,
      NETPULSE_UPDATE_REMOTE: status.remote,
      NETPULSE_UPDATE_BRANCH: status.branch,
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.unref();

  let doneSent = false;
  const finish = (type: "restarting" | "done" | "error", message: string) => {
    if (doneSent) return;
    doneSent = true;
    send(type, message);
    res.end();
  };

  child.stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      if (line.includes("NETPULSE_RESTART_NOW")) {
        finish("restarting", "Build and migrations are complete — server is restarting. Refreshing shortly to verify health.");
        return;
      }
      send("log", line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (line.trim()) send("log", line);
    }
  });

  child.on("close", (code) => {
    if (doneSent) return;
    finish(
      code === 0 ? "done" : "error",
      code === 0
        ? "Update complete."
        : `Update stopped with code ${code ?? "unknown"}. The running app was not restarted.`,
    );
  });

  child.on("error", (error) => {
    const message = error.message.includes("ENOENT")
      ? "Update script not found on this server."
      : error.message;
    finish("error", message);
  });

  req.on("close", () => {
    if (!doneSent) child.kill();
  });
});

export default router;