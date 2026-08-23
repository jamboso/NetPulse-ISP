import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSendSms = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, message: "sent" }));
const mockLogSms = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSendRouterAlertEmail = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, message: "sent" }));

vi.mock("@workspace/db", () => ({
  db: {},
  routersTable: { id: {}, monitorState: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

vi.mock("../lib/sms.js", () => ({
  getSettings: vi.fn(),
  sendSms: mockSendSms,
  logSms: mockLogSms,
}));

vi.mock("../lib/mailer.js", () => ({
  sendRouterAlertEmail: mockSendRouterAlertEmail,
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

const { sendRouterAlert } = await import("../lib/routerMonitor.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

describe("sendRouterAlert", () => {
  it("delivers a confirmed outage to configured SMS, Slack, and email channels", async () => {
    const settings = {
      smsProvider: "africas_talking",
      alertPhone: "0712345678",
      alertSlackWebhook: "https://hooks.slack.com/services/example",
      alertEmail: "operations@example.com",
      timezone: "Africa/Nairobi",
    };

    await sendRouterAlert("Core Router", "10.0.0.1", "offline", settings);

    expect(mockSendSms).toHaveBeenCalledWith(
      settings,
      "0712345678",
      expect.stringContaining('Router "Core Router" (10.0.0.1) is OFFLINE'),
    );
    expect(mockLogSms).toHaveBeenCalledWith(expect.objectContaining({
      triggerType: "router_down",
      status: "sent",
    }));
    expect(fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/example",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"text"'),
      }),
    );
    expect(mockSendRouterAlertEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "operations@example.com",
      subject: "Router offline: Core Router",
      text: expect.stringContaining("is OFFLINE"),
      settings,
    }));
  });

  it("delivers Slack and email alerts without changing SMS requirements", async () => {
    await sendRouterAlert("Core Router", "10.0.0.1", "online", {
      alertSlackWebhook: "https://hooks.slack.com/services/example",
      alertEmail: "operations@example.com",
      timezone: "Africa/Nairobi",
    });

    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockLogSms).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(mockSendRouterAlertEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Router recovered: Core Router",
      text: expect.stringContaining("back ONLINE"),
    }));
  });
});