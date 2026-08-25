import { Router } from "express";
import { db, routersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { resolveCompanyScope } from "../middlewares/companyScope";
import { getRouterManagementHost, routerManagementUnavailableMessage } from "../lib/routerManagement";
import { captureRouterSshHostKey, runRouterSshCommand } from "../lib/routerSsh";
import { writeAuditLog } from "../lib/audit";

const router = Router();
router.use(resolveCompanyScope);

const MAX_COMMAND_LENGTH = 4_000;

function scopedRouterWhere(req: import("express").Request, id: number) {
  return req.companyId != null
    ? and(eq(routersTable.id, id), eq(routersTable.companyId, req.companyId))
    : eq(routersTable.id, id);
}

function writeEvent(res: import("express").Response, value: object) {
  res.write(`data: ${JSON.stringify(value)}\n\n`);
}

async function findConsoleTarget(req: import("express").Request, res: import("express").Response) {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number.parseInt(rawId ?? "", 10);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid router id." });
    return null;
  }
  const [target] = await db.select().from(routersTable).where(scopedRouterWhere(req, id));
  if (!target) {
    res.status(404).json({ error: "Router not found." });
    return null;
  }
  if (target.routerType !== "routeros") {
    res.status(422).json({ error: "The command console is available only for RouterOS routers managed through the private NetPulse VPN." });
    return null;
  }
  const host = getRouterManagementHost(target);
  if (!host) {
    res.status(409).json({ error: routerManagementUnavailableMessage() });
    return null;
  }
  const port = target.sshPort ?? 2222;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    res.status(422).json({ error: "The router has an invalid SSH port configuration." });
    return null;
  }
  return { id, target, host, port };
}

router.post("/routers/:id/console/host-key", requireRole("admin"), async (req, res) => {
  const targetData = await findConsoleTarget(req, res);
  if (!targetData) return;

  try {
    const fingerprint = await captureRouterSshHostKey(targetData);
    res.json({ fingerprint });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the router SSH host key.";
    req.log.warn({ routerId: targetData.target.id, port: targetData.port, err: message }, "Router SSH host-key check failed");
    res.status(502).json({ error: message });
  }
});

router.post("/routers/:id/console/host-key/confirm", requireRole("admin"), async (req, res) => {
  const fingerprint = typeof req.body?.fingerprint === "string" ? req.body.fingerprint : "";
  if (!/^SHA256:[A-Za-z0-9+/]+$/u.test(fingerprint)) {
    res.status(400).json({ error: "Invalid SSH host-key fingerprint." });
    return;
  }
  const targetData = await findConsoleTarget(req, res);
  if (!targetData) return;

  const currentUser = req.user as { id?: string; email?: string } | undefined;
  if (!currentUser?.id) {
    res.status(403).json({ error: "Forbidden: user identity is unavailable." });
    return;
  }

  try {
    const observed = await captureRouterSshHostKey(targetData);
    if (observed !== fingerprint) {
      res.status(409).json({ error: "The router SSH key changed before it could be trusted. Verify the router identity and try again." });
      return;
    }
    await db.update(routersTable).set({ sshHostKey: fingerprint }).where(scopedRouterWhere(req, targetData.id));
    await writeAuditLog({
      companyId: req.companyId,
      userId: currentUser.id,
      userEmail: currentUser.email ?? null,
      action: "update",
      entityType: "router",
      entityId: targetData.target.id,
      diff: { operation: "ssh_host_key_enrolled", port: targetData.port },
    });
    res.json({ fingerprint });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify the router SSH host key.";
    req.log.warn({ routerId: targetData.target.id, port: targetData.port, err: message }, "Router SSH host-key enrollment failed");
    res.status(502).json({ error: message });
  }
});

router.post("/routers/:id/console/command", requireRole("admin"), async (req, res) => {
  const command = typeof req.body?.command === "string" ? req.body.command.trim() : "";
  if (!command || command.length > MAX_COMMAND_LENGTH) {
    res.status(400).json({ error: `Enter a command between 1 and ${MAX_COMMAND_LENGTH} characters.` });
    return;
  }
  const targetData = await findConsoleTarget(req, res);
  if (!targetData) return;
  const { id, target, host, port } = targetData;
  if (!target.sshHostKey) {
    res.status(409).json({ error: "Verify and trust this router’s SSH host key before opening the command console." });
    return;
  }

  const currentUser = req.user as { id?: string; email?: string } | undefined;
  if (!currentUser?.id) {
    res.status(403).json({ error: "Forbidden: user identity is unavailable." });
    return;
  }

  // Commands and output are deliberately omitted from the audit trail.
  await writeAuditLog({
    companyId: req.companyId,
    userId: currentUser.id,
    userEmail: currentUser.email ?? null,
    action: "read",
    entityType: "router",
    entityId: target.id,
    diff: { operation: "ssh_console_command", port },
  });

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  writeEvent(res, { type: "connected", host, port });

  const aborter = new AbortController();
  req.once("close", () => aborter.abort());

  try {
    const result = await runRouterSshCommand({
      host,
      port,
      username: target.username,
      password: target.password,
      hostKeyFingerprint: target.sshHostKey,
      command,
      signal: aborter.signal,
      onOutput: (output) => writeEvent(res, { type: "output", ...output }),
    });
    writeEvent(res, { type: "complete", exitCode: result.exitCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSH command failed.";
    req.log.warn({ routerId: target.id, port, err: message }, "Router SSH console command failed");
    await writeAuditLog({
      companyId: req.companyId,
      userId: currentUser.id,
      userEmail: currentUser.email ?? null,
      action: "failure",
      entityType: "router",
      entityId: target.id,
      diff: { operation: "ssh_console_command", port },
    });
    writeEvent(res, { type: "error", message });
  } finally {
    res.end();
  }
});

export default router;