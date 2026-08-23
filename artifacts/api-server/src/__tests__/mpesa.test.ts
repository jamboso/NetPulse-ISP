import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mockExec = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  values: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));
const mpesaConfigMocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  getCompanyByUsername: vi.fn(),
  getCompanyById: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ["from", "limit", "orderBy", "leftJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain["values"] = vi.fn((...args: unknown[]) => {
    dbMocks.values(...args);
    return chain;
  });
  chain["set"] = vi.fn((...args: unknown[]) => {
    dbMocks.set(...args);
    return chain;
  });
  chain["where"] = vi.fn((...args: unknown[]) => {
    dbMocks.where(...args);
    return chain;
  });
  chain["returning"] = vi.fn(() => {
    dbMocks.returning();
    return mockExec();
  });
  chain["then"] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    mockExec().then(resolve, reject);
  chain["catch"] = (reject: (reason: unknown) => unknown) => mockExec().catch(reject);

  return {
    db: {
      select: vi.fn((...args: unknown[]) => {
        dbMocks.select(...args);
        return chain;
      }),
      insert: vi.fn((...args: unknown[]) => {
        dbMocks.insert(...args);
        return chain;
      }),
      update: vi.fn((...args: unknown[]) => {
        dbMocks.update(...args);
        return chain;
      }),
    },
    paymentsTable: {
      id: {},
      companyId: {},
      customerId: {},
      invoiceId: {},
      amount: {},
      method: {},
      status: {},
      reference: {},
      notes: {},
      createdAt: {},
    },
    invoicesTable: { id: {}, customerId: {}, status: {}, paidAt: {} },
    customersTable: { id: {}, companyId: {}, phone: {}, name: {} },
    hotspotVouchersTable: { id: {}, checkoutRequestId: {} },
    hotspotPackagesTable: { id: {} },
    routersTable: { id: {} },
    eq: vi.fn(),
    ilike: vi.fn(),
    and: vi.fn(),
  };
});

vi.mock("../lib/mpesaConfig.js", () => ({
  resolveMpesaConfig: mpesaConfigMocks.resolve,
  getCompanyByUsername: mpesaConfigMocks.getCompanyByUsername,
  getCompanyById: mpesaConfigMocks.getCompanyById,
}));

// Callback authentication has its own focused route tests. These tests exercise
// the callback's payment-processing behavior after the request is authorized.
vi.mock("../middlewares/requireSafaricomIp.js", () => ({
  requireSafaricomIp: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middlewares/requireMpesaWebhookSecret.js", () => ({
  requireMpesaWebhookSecret: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { mpesaProtectedRouter, mpesaPublicRouter } = await import("../routes/mpesa.js");

const configuredMpesa = {
  companyId: 9,
  consumerKey: "consumer-key",
  consumerSecret: "consumer-secret",
  shortcode: "174379",
  passkey: "passkey",
  callbackUrl: "https://portal.example.test/api/mpesa/callback/acme",
  env: "sandbox",
};

function buildApp({ companyId = 9, userId = "staff-1" }: { companyId?: number; userId?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { companyId: number }).companyId = companyId;
    (req as unknown as { user: { id: string } }).user = { id: userId };
    (req as unknown as { log: Record<string, ReturnType<typeof vi.fn>> }).log = {
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    };
    next();
  });
  app.use(mpesaProtectedRouter);
  app.use(mpesaPublicRouter);
  return app;
}

function darajaResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successfulStkCallback() {
  return {
    Body: {
      stkCallback: {
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        MerchantRequestID: "merchant-request-1",
        CheckoutRequestID: "checkout-request-1",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 125 },
            { Name: "MpesaReceiptNumber", Value: "RKT123ABC" },
            { Name: "PhoneNumber", Value: 254712345678 },
          ],
        },
      },
    },
  };
}

beforeEach(() => {
  mockExec.mockReset();
  for (const mock of Object.values(dbMocks)) mock.mockClear();
  mpesaConfigMocks.resolve.mockReset();
  mpesaConfigMocks.getCompanyByUsername.mockReset();
  mpesaConfigMocks.getCompanyById.mockReset();
  mpesaConfigMocks.resolve.mockResolvedValue(configuredMpesa);
  vi.stubGlobal("fetch", vi.fn());
});

describe("POST /mpesa/stk-push", () => {
  it("starts an STK push with a normalized phone number and returns Daraja identifiers", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(darajaResponse({ access_token: "daraja-token" }))
      .mockResolvedValueOnce(darajaResponse({
        ResponseCode: "0",
        CheckoutRequestID: "checkout-123",
        MerchantRequestID: "merchant-123",
      }));

    const response = await request(buildApp({ userId: "stk-success" }))
      .post("/mpesa/stk-push")
      .send({
        phone: "0712345678",
        amount: 100.1,
        invoiceId: 77,
        accountRef: "ACME-77",
        description: "August internet",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      checkoutRequestId: "checkout-123",
      merchantRequestId: "merchant-123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/oauth/v1/generate");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      Amount: 101,
      PartyA: "254712345678",
      PhoneNumber: "254712345678",
      CallBackURL: configuredMpesa.callbackUrl,
      AccountReference: "ACME-77",
      TransactionDesc: "August internet",
    });
  });

  it.each<[Record<string, unknown>, string]>([
    [{ amount: 100 }, "phone"],
    [{ phone: "254712345678" }, "amount"],
  ])("returns a validation error when %s is missing", async (body, _missingField) => {
    const response = await request(buildApp({ userId: `stk-validation-${JSON.stringify(body)}` }))
      .post("/mpesa/stk-push")
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/phone and amount are required/i);
    expect(mpesaConfigMocks.resolve).not.toHaveBeenCalled();
  });

  it("reports an unavailable service when the tenant has not configured M-Pesa", async () => {
    mpesaConfigMocks.resolve.mockResolvedValueOnce({ companyId: 9, env: "sandbox" });

    const response = await request(buildApp({ userId: "stk-unconfigured" }))
      .post("/mpesa/stk-push")
      .send({ phone: "254712345678", amount: 100 });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatch(/not configured/i);
  });

  it("returns a gateway error when Daraja rejects the STK request", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(darajaResponse({ access_token: "daraja-token" }))
      .mockResolvedValueOnce(darajaResponse({ ResponseCode: "2001", errorMessage: "Invalid initiator" }, 400));

    const response = await request(buildApp({ userId: "stk-rejected" }))
      .post("/mpesa/stk-push")
      .send({ phone: "254712345678", amount: 100 });

    expect(response.status).toBe(502);
    expect(response.body).toMatchObject({ error: "STK Push request failed" });
  });
});

describe("M-Pesa payment webhooks", () => {
  it("acknowledges an STK callback reporting a failed or cancelled payment", async () => {
    const response = await request(buildApp())
      .post("/mpesa/callback")
      .send({
        Body: {
          stkCallback: {
            ResultCode: 1032,
            ResultDesc: "Request cancelled by user",
            MerchantRequestID: "merchant-request-1",
            CheckoutRequestID: "checkout-request-1",
          },
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it("acknowledges malformed STK callback payloads without recording a payment", async () => {
    const response = await request(buildApp()).post("/mpesa/callback").send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(dbMocks.insert).not.toHaveBeenCalled();
  });

  it("records a successful STK payment and reconciles it to the customer invoice", async () => {
    mockExec
      .mockResolvedValueOnce([]) // no pending hotspot voucher
      .mockResolvedValueOnce([{ id: 51, companyId: 9 }]) // customer lookup
      .mockResolvedValueOnce([{ id: 91 }]) // inserted payment
      .mockResolvedValueOnce([{ id: 83 }]) // invoice lookup
      .mockResolvedValueOnce([]) // link payment to invoice
      .mockResolvedValueOnce([]); // mark invoice paid

    const response = await request(buildApp()).post("/mpesa/callback").send(successfulStkCallback());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(dbMocks.values).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 51,
      companyId: 9,
      amount: "125",
      method: "mpesa",
      status: "completed",
      reference: "RKT123ABC",
    }));
    expect(dbMocks.set).toHaveBeenCalledWith({ invoiceId: 83 });
    expect(dbMocks.set).toHaveBeenCalledWith(expect.objectContaining({ status: "paid" }));
    expect(dbMocks.update).toHaveBeenCalledTimes(2);
  });

  it("records C2B confirmations using the matched customer and payment reference", async () => {
    mockExec
      .mockResolvedValueOnce([{ id: 52, companyId: 9 }])
      .mockResolvedValueOnce([]);

    const response = await request(buildApp()).post("/mpesa/c2b/confirmation").send({
      TransID: "QWE456RTY",
      TransAmount: "250",
      MSISDN: "254712345678",
      BillRefNumber: "INV-83",
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ResultCode: "0", ResultDesc: "Accepted" });
    expect(dbMocks.values).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 52,
      companyId: 9,
      amount: "250",
      reference: "QWE456RTY",
      notes: expect.stringContaining("BillRef: INV-83"),
    }));
  });
});

describe("Other M-Pesa operational routes", () => {
  it("registers C2B URLs after acquiring a Daraja token", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(darajaResponse({ access_token: "daraja-token" }))
      .mockResolvedValueOnce(darajaResponse({ ResponseDescription: "success" }));

    const response = await request(buildApp({ userId: "register-success" }))
      .post("/mpesa/register-urls")
      .send({
        confirmationUrl: "https://portal.example.test/c2b/confirmation",
        validationUrl: "https://portal.example.test/c2b/validation",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
      ShortCode: configuredMpesa.shortcode,
      ResponseType: "Completed",
    });
  });

  it("validates C2B URL registration input before contacting Daraja", async () => {
    const response = await request(buildApp({ userId: "register-validation" }))
      .post("/mpesa/register-urls")
      .send({ confirmationUrl: "https://portal.example.test/c2b/confirmation" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/confirmationUrl and validationUrl are required/i);
  });

  it("reports the current M-Pesa configuration status without exposing credentials", async () => {
    const response = await request(buildApp({ userId: "status-success" })).get("/mpesa/status");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      configured: true,
      environment: "sandbox",
      shortcode: "174379",
      callbackUrl: configuredMpesa.callbackUrl,
      webhookSecretConfigured: false,
    });
    expect(JSON.stringify(response.body)).not.toContain("consumer-key");
  });

  it("returns recorded M-Pesa transactions newest first", async () => {
    mockExec.mockResolvedValueOnce([
      { id: 1, reference: "old", amount: "100", status: "completed" },
      { id: 2, reference: "new", amount: "200", status: "completed" },
    ]);

    const response = await request(buildApp({ userId: "transactions-success" })).get("/mpesa/transactions?limit=5");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 2 });
    expect(response.body.data.map((payment: { id: number }) => payment.id)).toEqual([2, 1]);
  });
});