import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseListAuditLogs = vi.fn();
const mockUseGetAuditPurgeHistory = vi.fn();
const mockUsePurgeAuditLogs = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListAuditLogs: (...args: unknown[]) => mockUseListAuditLogs(...args),
  useGetAuditPurgeHistory: (...args: unknown[]) => mockUseGetAuditPurgeHistory(...args),
  usePurgeAuditLogs: (...args: unknown[]) => mockUsePurgeAuditLogs(...args),
  getListAuditLogsQueryKey: vi.fn(() => ["/api/audit-logs"]),
  getGetAuditPurgeHistoryQueryKey: vi.fn(() => ["/api/audit-logs/purge-history"]),
}));

vi.mock("wouter", () => ({
  useSearch: vi.fn(() => ""),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const emptyResponse = { data: [], page: 1, limit: 50 };

function setupDefaultMocks() {
  mockUseListAuditLogs.mockReturnValue({
    data: emptyResponse,
    isLoading: false,
    isError: false,
  });
  mockUseGetAuditPurgeHistory.mockReturnValue({
    data: { data: [] },
    isLoading: false,
  });
  mockUsePurgeAuditLogs.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

async function renderAuditLogs() {
  const { default: AuditLogs } = await import("../pages/audit-logs");
  return render(<AuditLogs />, { wrapper });
}

function getLastCallParams(): Record<string, unknown> {
  const calls = mockUseListAuditLogs.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMocks();
});

// ---------------------------------------------------------------------------
// Entity ID filter — UI tests
// ---------------------------------------------------------------------------

describe("Audit Logs — Entity ID filter: hook params", () => {
  it("does not include entityId when the input is empty on initial render", async () => {
    await renderAuditLogs();

    const params = getLastCallParams();
    expect(params).not.toHaveProperty("entityId");
  });

  it("passes entityId as a number to the hook after typing a valid integer", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();

    const entityIdInput = screen.getByPlaceholderText("Entity ID…");
    await user.type(entityIdInput, "42");

    await waitFor(() => {
      const params = getLastCallParams();
      expect(params).toHaveProperty("entityId", 42);
    });
  });

  it("removes entityId from params after clearing the input", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();

    const entityIdInput = screen.getByPlaceholderText("Entity ID…");
    await user.type(entityIdInput, "42");
    await waitFor(() => {
      expect(getLastCallParams()).toHaveProperty("entityId", 42);
    });

    await user.clear(entityIdInput);
    await waitFor(() => {
      expect(getLastCallParams()).not.toHaveProperty("entityId");
    });
  });

  it("passes the correct numeric value for a multi-digit entity ID", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();

    const entityIdInput = screen.getByPlaceholderText("Entity ID…");
    await user.type(entityIdInput, "1234");

    await waitFor(() => {
      expect(getLastCallParams()).toHaveProperty("entityId", 1234);
    });
  });
});

describe("Audit Logs — Entity ID filter: combined with entity type", () => {
  it("includes both entityType and entityId when entity type is pre-set via URL and ID is typed", async () => {
    const { useSearch } = await import("wouter");
    vi.mocked(useSearch).mockReturnValue("entityType=customer");
    setupDefaultMocks();

    const { default: AuditLogs } = await import("../pages/audit-logs");
    render(<AuditLogs />, { wrapper });

    const user = userEvent.setup();
    const entityIdInput = screen.getByPlaceholderText("Entity ID…");
    await user.type(entityIdInput, "7");

    await waitFor(() => {
      const params = getLastCallParams();
      expect(params).toHaveProperty("entityType", "customer");
      expect(params).toHaveProperty("entityId", 7);
    });
  });
});

describe("Audit Logs — Entity ID filter: table content", () => {
  it("shows the entity ID for a matching row in the table", async () => {
    const matchingLog = {
      id: 1,
      userId: "u1",
      userEmail: "admin@test.com",
      action: "create",
      entityType: "customer",
      entityId: 42,
      diff: null,
      createdAt: new Date().toISOString(),
    };
    mockUseListAuditLogs.mockReturnValue({
      data: { data: [matchingLog], page: 1, limit: 50 },
      isLoading: false,
      isError: false,
    });

    await renderAuditLogs();

    expect(screen.getByText("#42")).toBeInTheDocument();
  });

  it("shows 'No audit records match your filters' when the entity ID yields no results", async () => {
    mockUseListAuditLogs.mockReturnValue({
      data: emptyResponse,
      isLoading: false,
      isError: false,
    });

    await renderAuditLogs();
    const user = userEvent.setup();

    const entityIdInput = screen.getByPlaceholderText("Entity ID…");
    await user.type(entityIdInput, "9999");

    await waitFor(() => {
      expect(
        screen.getByText("No audit records match your filters."),
      ).toBeInTheDocument();
    });
  });
});
