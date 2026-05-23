import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendMail = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockCreateTransport = vi.hoisted(() => vi.fn().mockReturnValue({ sendMail: mockSendMail }));
const mockGetSettings = vi.hoisted(() => vi.fn());

vi.mock("nodemailer", () => ({
  default: { createTransport: mockCreateTransport },
}));

vi.mock("../lib/sms.js", () => ({
  getSettings: mockGetSettings,
}));

const { sendStaffWelcomeEmail, buildWelcomeEmailText, buildWelcomeEmailHtml } =
  await import("../lib/mailer.js");

const SMTP_SETTINGS = {
  smtpHost: "smtp.example.com",
  smtpUser: "user@example.com",
  smtpPass: "secret",
  smtpPort: "587",
  smtpFrom: "noreply@example.com",
  companyName: "Acme ISP",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendStaffWelcomeEmail — SMTP configured", () => {
  it("calls nodemailer createTransport with the SMTP settings", async () => {
    mockGetSettings.mockResolvedValue(SMTP_SETTINGS);

    await sendStaffWelcomeEmail({
      name: "Alice",
      email: "alice@example.com",
      password: "Temp@1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    expect(mockCreateTransport).toHaveBeenCalledOnce();
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        auth: expect.objectContaining({ user: "user@example.com", pass: "secret" }),
      }),
    );
  });

  it("sends mail to the staff member's email address", async () => {
    mockGetSettings.mockResolvedValue(SMTP_SETTINGS);

    await sendStaffWelcomeEmail({
      name: "Alice",
      email: "alice@example.com",
      password: "Temp@1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        from: "noreply@example.com",
      }),
    );
  });

  it("includes the staff member's name, role label, and appUrl in the email body", async () => {
    mockGetSettings.mockResolvedValue(SMTP_SETTINGS);

    await sendStaffWelcomeEmail({
      name: "Alice",
      email: "alice@example.com",
      password: "Temp@1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    const { text, html } = mockSendMail.mock.calls[0][0] as { text: string; html: string };
    expect(text).toContain("Alice");
    expect(text).toContain("Support (customers/tickets)");
    expect(text).toContain("https://app.example.com");
    expect(html).toContain("Alice");
    expect(html).toContain("Support (customers/tickets)");
    expect(html).toContain("https://app.example.com");
  });

  it("uses the company name from settings in the subject line", async () => {
    mockGetSettings.mockResolvedValue(SMTP_SETTINGS);

    await sendStaffWelcomeEmail({
      name: "Bob",
      email: "bob@example.com",
      password: "Temp@5678",
      role: "admin",
      appUrl: "https://app.example.com",
    });

    const { subject } = mockSendMail.mock.calls[0][0] as { subject: string };
    expect(subject).toContain("Acme ISP");
  });

  it("returns { success: true } when the email is delivered", async () => {
    mockGetSettings.mockResolvedValue(SMTP_SETTINGS);

    const result = await sendStaffWelcomeEmail({
      name: "Alice",
      email: "alice@example.com",
      password: "Temp@1234",
      role: "billing",
      appUrl: "https://app.example.com",
    });

    expect(result).toEqual({ success: true, message: "Welcome email sent" });
  });

  it("returns { success: false } and does not throw when sendMail rejects", async () => {
    mockGetSettings.mockResolvedValue(SMTP_SETTINGS);
    mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await sendStaffWelcomeEmail({
      name: "Alice",
      email: "alice@example.com",
      password: "Temp@1234",
      role: "technician",
      appUrl: "https://app.example.com",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Connection refused");
  });
});

describe("sendStaffWelcomeEmail — SMTP not configured", () => {
  it("skips sending and returns success:false when smtpHost is missing", async () => {
    mockGetSettings.mockResolvedValue({ smtpUser: "u", smtpPass: "p" });

    const result = await sendStaffWelcomeEmail({
      name: "Carol",
      email: "carol@example.com",
      password: "pass1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/SMTP not configured/i);
  });

  it("skips sending and returns success:false when smtpUser is missing", async () => {
    mockGetSettings.mockResolvedValue({ smtpHost: "smtp.example.com", smtpPass: "p" });

    const result = await sendStaffWelcomeEmail({
      name: "Carol",
      email: "carol@example.com",
      password: "pass1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("skips sending and returns success:false when smtpPass is missing", async () => {
    mockGetSettings.mockResolvedValue({ smtpHost: "smtp.example.com", smtpUser: "u" });

    const result = await sendStaffWelcomeEmail({
      name: "Carol",
      email: "carol@example.com",
      password: "pass1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
  });

  it("does not throw when SMTP settings are completely absent from the settings table", async () => {
    mockGetSettings.mockResolvedValue({});

    await expect(
      sendStaffWelcomeEmail({
        name: "Dave",
        email: "dave@example.com",
        password: "pass1234",
        role: "admin",
        appUrl: "https://app.example.com",
      }),
    ).resolves.not.toThrow();

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("buildWelcomeEmailText", () => {
  it("includes all required fields in the plain-text body", () => {
    const text = buildWelcomeEmailText({
      name: "Eve",
      email: "eve@example.com",
      password: "Temp@pass",
      role: "technician",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Technician (network/equipment)",
    });

    expect(text).toContain("Eve");
    expect(text).toContain("eve@example.com");
    expect(text).toContain("Temp@pass");
    expect(text).toContain("Technician (network/equipment)");
    expect(text).toContain("https://isp.example.com");
    expect(text).toContain("ISP Co");
  });
});

describe("buildWelcomeEmailHtml", () => {
  it("includes all required fields in the HTML body", () => {
    const html = buildWelcomeEmailHtml({
      name: "Frank",
      email: "frank@example.com",
      password: "Temp@pass",
      role: "billing",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Billing (invoices/payments)",
    });

    expect(html).toContain("Frank");
    expect(html).toContain("frank@example.com");
    expect(html).toContain("Temp@pass");
    expect(html).toContain("Billing (invoices/payments)");
    expect(html).toContain("https://isp.example.com");
    expect(html).toContain("ISP Co");
  });
});
