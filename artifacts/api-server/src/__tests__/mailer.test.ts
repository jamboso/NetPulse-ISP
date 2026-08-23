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

const {
  sendRouterAlertEmail,
  sendStaffWelcomeEmail,
  sendStaffInactivityDigestEmail,
  buildWelcomeEmailText,
  buildWelcomeEmailHtml,
  buildWelcomeEmailSubject,
} =
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

  it("uses the configured subject, greeting, and footer from settings", async () => {
    mockGetSettings.mockResolvedValue({
      ...SMTP_SETTINGS,
      emailSubject: "{company} access details for {name}",
      emailGreeting: "Hello {name}, welcome to {company}.",
      emailFooter: "Reply to this email if you need help.",
    });

    await sendStaffWelcomeEmail({
      name: "Alice",
      email: "alice@example.com",
      password: "Temp@1234",
      role: "support",
      appUrl: "https://app.example.com",
    });

    const { subject, text, html } = mockSendMail.mock.calls[0][0] as {
      subject: string;
      text: string;
      html: string;
    };
    expect(subject).toBe("Acme ISP access details for Alice");
    expect(text).toContain("Hello Alice, welcome to Acme ISP.");
    expect(text).toContain("Reply to this email if you need help.");
    expect(html).toContain("Hello Alice, welcome to Acme ISP.");
    expect(html).toContain("Reply to this email if you need help.");
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

describe("sendRouterAlertEmail", () => {
  it("sends the supplied router message through the configured SMTP server", async () => {
    const result = await sendRouterAlertEmail({
      to: "operations@example.com",
      subject: "Router offline: Core Router",
      text: "Core Router is OFFLINE.",
      settings: SMTP_SETTINGS,
    });

    expect(result).toEqual({ success: true, message: "Router alert email sent" });
    expect(mockGetSettings).not.toHaveBeenCalled();
    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.example.com",
      port: 587,
      auth: { user: "user@example.com", pass: "secret" },
    }));
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "operations@example.com",
      subject: "Router offline: Core Router",
      text: "Core Router is OFFLINE.",
    });
  });

  it("does not attempt delivery when the SMTP settings are incomplete", async () => {
    const result = await sendRouterAlertEmail({
      to: "operations@example.com",
      subject: "Router offline: Core Router",
      text: "Core Router is OFFLINE.",
      settings: { smtpHost: "smtp.example.com", smtpUser: "user@example.com" },
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/SMTP not configured/i);
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("sendStaffInactivityDigestEmail", () => {
  it("sends every admin a digest with the inactive accounts and direct Staff-page link", async () => {
    const result = await sendStaffInactivityDigestEmail({
      to: ["admin-one@example.com", "admin-two@example.com"],
      companyName: "Acme ISP",
      staffPageUrl: "https://portal.example.com/staff",
      inactiveUsers: [
        {
          name: "Stale Staff",
          email: "stale@example.com",
          role: "support",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          lastActiveAt: new Date("2026-07-01T00:00:00Z"),
        },
        {
          name: "Never Logged In",
          email: "never@example.com",
          role: "technician",
          createdAt: new Date("2026-06-01T00:00:00Z"),
          lastActiveAt: null,
        },
      ],
      settings: SMTP_SETTINGS,
    });

    expect(result).toEqual({ success: true, message: "Staff inactivity digest sent" });
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: ["admin-one@example.com", "admin-two@example.com"],
      subject: "Acme ISP — Staff inactivity alert (2)",
      text: expect.stringContaining("Stale Staff"),
      html: expect.stringContaining("https://portal.example.com/staff"),
    }));

    const { text, html } = mockSendMail.mock.calls[0][0] as { text: string; html: string };
    expect(text).toContain("Never logged in");
    expect(text).toContain("https://portal.example.com/staff");
    expect(html).toContain("Never Logged In");
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

  it("keeps login details and the password-change warning readable as plain text", () => {
    const text = buildWelcomeEmailText({
      name: "Eve",
      email: "eve@example.com",
      password: "Temp@pass",
      role: "technician",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Technician (network/equipment)",
    });

    expect(text).toContain("Email:    eve@example.com");
    expect(text).toContain("Password: Temp@pass");
    expect(text).toContain("Please log in and change your password immediately.");
  });

  it("uses the configured greeting and footer with personalized values", () => {
    const text = buildWelcomeEmailText({
      name: "Eve",
      email: "eve@example.com",
      password: "Temp@pass",
      role: "technician",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Technician (network/equipment)",
      emailGreeting: "Hello {name}, welcome to {company}.",
      emailFooter: "Questions? Visit {appUrl}",
    });

    expect(text).toContain("Hello Eve, welcome to ISP Co.");
    expect(text).toContain("Questions? Visit https://isp.example.com");
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

  it("returns a complete HTML fragment with a sign-in link", () => {
    const html = buildWelcomeEmailHtml({
      name: "Frank",
      email: "frank@example.com",
      password: "Temp@pass",
      role: "billing",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Billing (invoices/payments)",
    });

    expect(html).toMatch(/<div[\s\S]*<\/div>/);
    expect(html).toContain('href="https://isp.example.com"');
    expect(html).toContain("Sign In Now");
  });

  it("uses the configured greeting and footer without rendering template HTML", () => {
    const html = buildWelcomeEmailHtml({
      name: "Frank",
      email: "frank@example.com",
      password: "Temp@pass",
      role: "billing",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Billing (invoices/payments)",
      emailGreeting: "Hello {name} <strong>there</strong>",
      emailFooter: "Thanks,<br>{company}",
    });

    expect(html).toContain("Hello Frank &lt;strong&gt;there&lt;/strong&gt;");
    expect(html).toContain("Thanks,&lt;br&gt;ISP Co");
  });
});

describe("buildWelcomeEmailSubject", () => {
  it("uses the configured subject and resolves company variables", () => {
    const subject = buildWelcomeEmailSubject({
      name: "Eve",
      email: "eve@example.com",
      password: "Temp@pass",
      role: "technician",
      appUrl: "https://isp.example.com",
      company: "ISP Co",
      roleLabel: "Technician (network/equipment)",
      emailSubject: "{company} staff access for {name}",
    });

    expect(subject).toBe("ISP Co staff access for Eve");
  });
});
