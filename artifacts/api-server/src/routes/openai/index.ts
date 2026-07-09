import { Router, type IRouter } from "express";
import { db, conversations, messages } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireRole } from "../../middlewares/requireRole";
import { getDiagnosticsSnapshot, formatSnapshotForPrompt } from "../../lib/diagnostics";

const router: IRouter = Router();

router.use(requireRole("admin"));

const SYSTEM_PROMPT_PREFIX = `You are the NetPulse ISP Manager diagnostics assistant. You help the admin
understand the current health of their self-hosted ISP management system (customers, billing,
support tickets, routers, IP pools, VPN). You are given a live diagnostics snapshot below —
use it to answer questions about system health, and proactively flag issues you notice
(e.g. schema drift, offline routers, DB connectivity problems). Be concise and specific.
If something looks wrong, suggest a concrete next step (e.g. "click Update Now in Settings",
"check deploy/schema.sql", "check router VPN connection"). Do not fabricate data outside the snapshot;
say when you don't have enough information.

Current diagnostics snapshot:
`;

// ── GET /openai/diagnostics-snapshot ─────────────────────────────────────────
router.get("/openai/diagnostics-snapshot", async (req, res) => {
  const snapshot = await getDiagnosticsSnapshot();
  res.json(snapshot);
});

// ── GET /openai/conversations ─────────────────────────────────────────────────
router.get("/openai/conversations", async (req, res) => {
  const rows = await db.select().from(conversations).orderBy(asc(conversations.id));
  res.json(rows);
});

// ── POST /openai/conversations ────────────────────────────────────────────────
router.post("/openai/conversations", async (req, res) => {
  const title = typeof req.body?.title === "string" && req.body.title.trim() ? req.body.title.trim() : "New conversation";
  const [row] = await db.insert(conversations).values({ title }).returning();
  res.status(201).json(row);
});

// ── GET /openai/conversations/:id ─────────────────────────────────────────────
router.get("/openai/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.id));
  res.json({ ...conversation, messages: msgs });
});

// ── DELETE /openai/conversations/:id ──────────────────────────────────────────
router.delete("/openai/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const deleted = await db.delete(conversations).where(eq(conversations.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.status(204).end();
});

// ── GET /openai/conversations/:id/messages ────────────────────────────────────
router.get("/openai/conversations/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.id));
  res.json(rows);
});

// ── POST /openai/conversations/:id/messages — SSE streaming chat ─────────────
router.post("/openai/conversations/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

  const priorMessages = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.id));

  const snapshot = await getDiagnosticsSnapshot();
  const systemPrompt = SYSTEM_PROMPT_PREFIX + formatSnapshotForPrompt(snapshot);

  const chatMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...priorMessages.map((m) => ({
      role: (m.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: m.content,
    })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let fullResponse = "";

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 4096,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
      }
    }

    if (fullResponse.trim()) {
      await db.insert(messages).values({ conversationId: id, role: "assistant", content: fullResponse });
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log?.error({ err }, "openai diagnostics chat failed");
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
    res.end();
  }
});

export default router;
