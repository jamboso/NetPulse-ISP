import { Router, type Request, type Response } from "express";
import { execFileSync, spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { z } from "zod";
import { requireRole } from "../middlewares/requireRole";

const router = Router();
const commitPattern = /^[0-9a-f]{40}$/i;
let updateInProgress = false;

type ReleaseInfo = {
  localCommit: string;
  branch: string;
  remote: string;
  candidateCommit: string;
  commitMessage: string;
  commitDate: string;
};

type UpdateStatus = {
  state: "idle" | "preflight" | "backing-up" | "updating" | "installing" | "building" | "migrating" | "restarting" | "health-check" | "succeeded" | "failed" | "no-update";
  phase: string;
  message: string;
  targetCommit?: string;
  previousCommit?: string;
  backupPath?: string;
  updatedAt?: string;
};

const DeployUpdateBody = z.object({
  targetCommit: z.string().regex(commitPattern, "targetCommit must be a full Git commit SHA"),
  confirmation: z.string().min(1).max(64),
});

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseGithubOwnerRepo(remoteUrl: string): { owner: string; repo: string } | null {
  const match = remoteUrl.match(/github\.com[:/]+([^/]+)\/([^/]+?)(\.git)?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

async function fetchGithubCommitMeta(
  owner: string,
  repo: string,
  sha: string,
): Promise<{ message: string; date: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, {
      headers: { "User-Agent": "netpulse-update-check", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } } };
    const message = data.commit?.message?.split("\n")[0]?.trim();
    const date = data.commit?.committer?.date ?? data.commit?.author?.date;
    if (!message || !date) return null;
    return { message, date };
  } catch {
    return null;
  }
}

async function trackedRelease(cwd: string): Promise<ReleaseInfo> {
  const checkoutBranch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd);
  const remote = git(["config", "--get", `branch.${checkoutBranch}.remote`], cwd);
  const mergeRef = git(["config", "--get", `branch.${checkoutBranch}.merge`], cwd);
  const remoteBranch = mergeRef.replace(/^refs\/heads\//, "");

  if (!remote || !remoteBranch || !mergeRef.startsWith("refs/heads/")) {
    throw new Error("The deployed checkout does not track a production branch.");
  }

  // `ls-remote` only talks to the network and prints refs — unlike `fetch`, it
  // never writes FETCH_HEAD or updates local refs, so it works even though the
  // app process (unlike the root-run updater) only has read access to a
  // root-owned checkout.
  const lsRemoteOutput = git(["ls-remote", "--exit-code", remote, `refs/heads/${remoteBranch}`], cwd);
  const candidateCommit = lsRemoteOutput.split(/\s+/)[0];
  if (!candidateCommit) {
    throw new Error("The remote did not report a commit for the tracked branch.");
  }

  // Commit message/date are cosmetic, so fetch them best-effort from GitHub's
  // API (read-only, unauthenticated, no local write) rather than requiring a
  // local `git fetch` just to render a subject line.
  const remoteUrl = git(["remote", "get-url", remote], cwd);
  const ghInfo = parseGithubOwnerRepo(remoteUrl);
  const meta = ghInfo ? await fetchGithubCommitMeta(ghInfo.owner, ghInfo.repo, candidateCommit) : null;

  return {
    localCommit: git(["rev-parse", "HEAD"], cwd),
    branch: remoteBranch,
    remote,
    candidateCommit,
    commitMessage: meta?.message ?? "(commit message unavailable)",
    commitDate: meta?.date ?? "",
  };
}

function statusFile(): string {
  return process.env["NETPULSE_UPDATE_STATUS_FILE"] ?? "/var/lib/netpulse/update-status.json";
}

function readUpdateStatus(): UpdateStatus {
  try {
    const parsed = JSON.parse(readFileSync(statusFile(), "utf8")) as Partial<UpdateStatus>;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.phase !== "string" ||
      typeof parsed.message !== "string"
    ) {
      throw new Error("Invalid update status");
    }
    return parsed as UpdateStatus;
  } catch {
    return {
      state: updateInProgress ? "preflight" : "idle",
      phase: updateInProgress ? "preflight" : "idle",
      message: updateInProgress ? "Deployment is starting." : "No deployment has been started.",
    };
  }
}

function isValidConfirmation(value: string, targetCommit: string): boolean {
  return value.trim().toLowerCase() === targetCommit.toLowerCase();
}

function sendEvent(res: Response, type: "phase" | "log" | "done" | "error", data: string): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Update discovery intentionally fetches only the tracked branch; it never
// checks out code or starts a deployment. Owner-only because commit and remote
// details are operational information.
router.get("/system/version", requireRole("owner"), async (req: Request, res: Response): Promise<void> => {
  const appDir = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";

  try {
    const release = await trackedRelease(appDir);
    const previousDeployment = readUpdateStatus();
    const retryAvailable =
      previousDeployment.state === "failed" &&
      previousDeployment.targetCommit?.toLowerCase() === release.candidateCommit.toLowerCase();
    const updateAvailable = release.localCommit !== release.candidateCommit || retryAvailable;
    res.json({
      commit: release.localCommit.slice(0, 7),
      commitFull: release.localCommit,
      branch: release.branch,
      candidateCommit: release.candidateCommit,
      remoteCommit: release.candidateCommit.slice(0, 7),
      candidateMessage: release.commitMessage,
      candidateDate: release.commitDate,
      updateAvailable,
      status: retryAvailable ? "retry-available" : updateAvailable ? "update-available" : "up-to-date",
      isProduction: process.env["NODE_ENV"] === "production",
      deployment: readUpdateStatus(),
    });
  } catch (error) {
    req.log?.warn({ err: error }, "Production update preflight failed");
    res.status(503).json({
      status: "preflight-failed",
      message: "Could not read the configured production branch. No deployment was started.",
      isProduction: process.env["NODE_ENV"] === "production",
    });
  }
});

router.get("/system/update/status", requireRole("owner"), async (_req: Request, res: Response): Promise<void> => {
  res.json(readUpdateStatus());
});

// The target SHA must be the current candidate on the configured tracked
// branch. The script repeats this preflight immediately before changing code,
// protecting against a branch moving between confirmation and deployment.
router.post("/system/update", requireRole("owner"), async (req: Request, res: Response): Promise<void> => {
  const parsed = DeployUpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A full target commit and matching confirmation are required." });
    return;
  }

  if (!isValidConfirmation(parsed.data.confirmation, parsed.data.targetCommit)) {
    res.status(400).json({ error: "Confirmation must exactly match the target commit." });
    return;
  }

  if (updateInProgress) {
    res.status(409).json({ error: "Another deployment is already in progress." });
    return;
  }

  const appDir = process.env["NETPULSE_DIR"] ?? "/opt/netpulse";
  let release: ReleaseInfo;
  try {
    release = await trackedRelease(appDir);
  } catch (error) {
    req.log?.warn({ err: error }, "Deployment rejected during preflight");
    res.status(503).json({ error: "Deployment preflight failed. No code was changed." });
    return;
  }

  if (release.candidateCommit.toLowerCase() !== parsed.data.targetCommit.toLowerCase()) {
    res.status(409).json({ error: "The production branch changed. Check again and confirm the new commit." });
    return;
  }

  const previousDeployment = readUpdateStatus();
  const retryingFailedRelease =
    release.localCommit === release.candidateCommit &&
    previousDeployment.state === "failed" &&
    previousDeployment.targetCommit?.toLowerCase() === release.candidateCommit.toLowerCase();

  if (release.localCommit === release.candidateCommit && !retryingFailedRelease) {
    res.status(409).json({ error: "No update is available for the configured production branch." });
    return;
  }

  const updateScript = path.join(appDir, "deploy", "update.sh");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  updateInProgress = true;
  sendEvent(res, "phase", `Preflight passed. Deploying ${release.candidateCommit.slice(0, 7)} from ${release.branch}.`);

  let child: ChildProcess;
  try {
    child = spawn("sudo", ["-n", updateScript, ...(retryingFailedRelease ? ["--retry"] : []), release.candidateCommit], {
      cwd: appDir,
      env: { ...process.env },
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error) {
    updateInProgress = false;
    sendEvent(res, "error", "Could not start the deployment script.");
    res.end();
    req.log?.error({ err: error }, "Could not start deployment script");
    return;
  }

  let responseClosed = false;
  const finish = (type: "done" | "error", message: string): void => {
    if (responseClosed) return;
    responseClosed = true;
    clearInterval(statusTicker);
    sendEvent(res, type, message);
    res.end();
  };

  const statusTicker = setInterval(() => {
    const status = readUpdateStatus();
    sendEvent(res, "phase", `${status.phase}: ${status.message}`);
    if (status.state === "succeeded") finish("done", status.message);
    if (status.state === "failed") finish("error", status.message);
  }, 2_000);
  statusTicker.unref();
  child.on("close", (code) => {
    updateInProgress = false;
    if (code === 0) {
      finish("done", "Deployment completed. Health check passed.");
    } else {
      finish("error", "Deployment stopped safely. Check the final status for the failed phase.");
    }
  });
  child.on("error", (error) => {
    updateInProgress = false;
    req.log?.error({ err: error }, "Deployment process failed");
    finish("error", "The deployment process could not run.");
  });

  // The detached process deliberately outlives this response and even the API
  // process itself when PM2 restarts. Owners reconnect through the status
  // endpoint rather than cancelling a release by closing their browser.
});

export default router;