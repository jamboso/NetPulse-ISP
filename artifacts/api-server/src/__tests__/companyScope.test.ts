import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
  companiesTable: { id: {} },
}));

const { resolveCompanyScope } = await import("../middlewares/companyScope.js");

function ownerRequest(options: { query?: Record<string, unknown>; header?: string } = {}) {
  const req = {
    user: { role: "owner" },
    query: options.query ?? {},
    headers: options.header ? { "x-netpulse-company-id": options.header } : {},
  } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("company scope", () => {
  it("accepts an explicit owner company scope from the tenant workspace header", async () => {
    const { req, res, next } = ownerRequest({ header: "42" });

    await resolveCompanyScope(req, res, next);

    expect(req.companyId).toBe(42);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("keeps the query company scope as the explicit owner override", async () => {
    const { req, res, next } = ownerRequest({ query: { companyId: "7" }, header: "42" });

    await resolveCompanyScope(req, res, next);

    expect(req.companyId).toBe(7);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not create a tenant scope for malformed owner header input", async () => {
    const { req, res, next } = ownerRequest({ header: "not-a-company" });

    await resolveCompanyScope(req, res, next);

    expect(req.companyId).toBeNull();
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});