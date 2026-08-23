import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseListAuditLogs = vi.fn();
const mockUseGetAuditPurgeHistory = vi.fn();
const mockUsePurgeAuditLogs = vi.fn();
const mockUseGetSettings = vi.fn();
const mockUseUpdateSettings = vi.fn();
const mockUseCurrentUser = vi.fn();
const mockFetch = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListAuditLogs: (...args: unknown[]) => mockUseListAuditLogs(...args),
  useGetAuditPurgeHistory: (...args: unknown[]) => mockUseGetAuditPurgeHistory(...args),
  usePurgeAuditLogs: (...args: unknown[]) => mockUsePurgeAuditLogs(...args),
  useGetSettings: (...args: unknown[]) => mockUseGetSettings(...args),
  useUpdateSettings: (...args: unknown[]) => mockUseUpdateSettings(...args),
  getListAuditLogsQueryKey: vi.fn(() => ["/api/audit-logs"]),
  getGetAuditPurgeHistoryQueryKey: vi.fn(() => ["/api/audit-logs/purge-history"]),
  getGetSettingsQueryKey: vi.fn(() => ["/api/settings"]),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

// ---------------------------------------------------------------------------
// Reactive URL mock
//
// The component drives all filter state from the URL: it reads useSearch() on
// every render and calls setLocation() when the user changes a filter. In a
// real browser, wouter re-renders the tree on history changes. In jsdom we
// replicate that by maintaining a listener list: setLocation() updates
// `currentSearch` and notifies listeners. The ReactiveWrapper subscribes and
// owns a React state slice for search, so any setLocation() call triggers a
// proper re-render and lets the component pick up the new URL params.
// ---------------------------------------------------------------------------

let currentSearch = "";
const urlListeners: Array<(search: string) => void> = [];

function notifyUrlListeners() {
  urlListeners.forEach((fn) => fn(currentSearch));
}

function navigateBrowserHistory(search: string) {
  currentSearch = search;
  notifyUrlListeners();
}

const mockSetLocation = vi.fn((path: string) => {
  const qIndex = path.indexOf("?");
  currentSearch = qIndex >= 0 ? path.slice(qIndex + 1) : "";
  notifyUrlListeners();
});

const mockUseSearch = vi.fn(() => currentSearch);

vi.mock("wouter", () => ({
  useSearch: () => mockUseSearch(),
  useLocation: () => ["", mockSetLocation],
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A wrapper that subscribes to URL changes and re-renders the component tree
 * whenever setLocation is called, keeping mockUseSearch in sync.
 */
function ReactiveWrapper({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState(currentSearch);

  useEffect(() => {
    const handler = (s: string) => setSearch(s);
    urlListeners.push(handler);
    return () => {
      const idx = urlListeners.indexOf(handler);
      if (idx >= 0) urlListeners.splice(idx, 1);
    };
  }, []);

  // Keep the mock in sync with the reactive state so the component reads the
  // correct value on each render triggered by a URL update.
  mockUseSearch.mockReturnValue(search);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const emptyResponse = { data: [], page: 1, limit: 50 };

function setupDefaultMocks() {
  mockUseCurrentUser.mockReturnValue({
    id: "u1",
    role: "owner",
    isAdmin: false,
    isOwner: true,
  });
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
  mockUseGetSettings.mockReturnValue({
    data: { auditLogRetentionDays: "90" },
    isLoading: false,
  });
  mockUseUpdateSettings.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

async function renderAuditLogs() {
  const { default: AuditLogs } = await import("../pages/audit-logs");
  return render(<AuditLogs />, { wrapper: ReactiveWrapper });
}

function getLastCallParams(): Record<string, unknown> {
  const calls = mockUseListAuditLogs.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:audit-export"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  currentSearch = "";
  urlListeners.length = 0;
  mockUseSearch.mockReturnValue("");
  // Restore setLocation side-effect after clearAllMocks resets it.
  mockSetLocation.mockImplementation((path: string) => {
    const qIndex = path.indexOf("?");
    currentSearch = qIndex >= 0 ? path.slice(qIndex + 1) : "";
    notifyUrlListeners();
  });
  setupDefaultMocks();
});

describe("Audit Logs — staff self-export", () => {
  it.each([
    ["billing", "u2"],
    ["support", "u3"],
    ["technician", "u4"],
  ])("lets %s staff download only their own activity", async (role, userId) => {
    mockUseCurrentUser.mockReturnValue({
      id: userId,
      role,
      isAdmin: false,
      isOwner: false,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["audit activity"], { type: "text/csv" }),
    });

    await renderAuditLogs();
    const user = userEvent.setup();

    expect(mockUseListAuditLogs).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /download my activity/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/audit-logs/export.csv?userId=${userId}`,
        { credentials: "include" },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Entity ID filter — UI tests
// ---------------------------------------------------------------------------

describe("Audit Logs — Entity ID filter: hook params", () => {
  it("pre-fills the entity ID from the URL and immediately queries with it", async () => {
    currentSearch = "entityId=42";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();

    expect(screen.getByPlaceholderText("Entity ID…")).toHaveValue(42);
    expect(getLastCallParams()).toEqual(
      expect.objectContaining({ entityId: 42 }),
    );
  });

  it("does not include entityId when the input is empty on initial render", async () => {
    await renderAuditLogs();

    const params = getLastCallParams();
    expect(params).not.toHaveProperty("entityId");
  });

  it("handles non-numeric typing without passing entityId to the hook", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();

    const entityIdInput = screen.getByPlaceholderText("Entity ID…");
    await user.type(entityIdInput, "not-a-number");

    expect(entityIdInput).toHaveValue(null);
    expect(getLastCallParams()).not.toHaveProperty("entityId");
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
  it("pre-fills entity type and ID together from the URL", async () => {
    currentSearch = "entityType=customer&entityId=42";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();

    expect(screen.getByText("Customer")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Entity ID…")).toHaveValue(42);
    expect(getLastCallParams()).toEqual(
      expect.objectContaining({ entityType: "customer", entityId: 42 }),
    );
  });

  it("includes both entityType and entityId when entity type is pre-set via URL and ID is typed", async () => {
    currentSearch = "entityType=customer";
    mockUseSearch.mockReturnValue(currentSearch);
    setupDefaultMocks();

    const { default: AuditLogs } = await import("../pages/audit-logs");
    render(<AuditLogs />, { wrapper: ReactiveWrapper });

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

// ---------------------------------------------------------------------------
// URL filter synchronization
// ---------------------------------------------------------------------------

describe("Audit Logs — URL filter synchronization", () => {
  it("updates the URL query string when an entity type is selected", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();
    const [entityTypeSelect] = screen.getAllByRole("combobox");

    await user.click(entityTypeSelect);
    await user.click(await screen.findByRole("option", { name: "Invoice" }));

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenLastCalledWith(
        "/audit-logs?entityType=invoice",
        { replace: false },
      );
    });
  });

  it("pre-populates the entity type and action dropdowns from a filter URL", async () => {
    currentSearch = "entityType=invoice&action=create";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();

    const [entityTypeSelect, actionSelect] = screen.getAllByRole("combobox");
    expect(entityTypeSelect).toHaveTextContent("Invoice");
    expect(actionSelect).toHaveTextContent("Create");
  });

  it("includes the user search text in the URL", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText("User email…"), "sam@example.com");

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenLastCalledWith(
        "/audit-logs?user=sam%40example.com",
        { replace: true },
      );
    });
  });

  it("restores filters when browser back and forward navigation changes the URL", async () => {
    currentSearch = "entityType=invoice&action=create";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();

    await act(async () => {
      navigateBrowserHistory("entityType=customer&action=delete");
    });

    let [entityTypeSelect, actionSelect] = screen.getAllByRole("combobox");
    expect(entityTypeSelect).toHaveTextContent("Customer");
    expect(actionSelect).toHaveTextContent("Delete");

    await act(async () => {
      navigateBrowserHistory("entityType=invoice&action=create");
    });

    [entityTypeSelect, actionSelect] = screen.getAllByRole("combobox");
    expect(entityTypeSelect).toHaveTextContent("Invoice");
    expect(actionSelect).toHaveTextContent("Create");
  });

  it("initializes entity type, entity ID, and action filters from the URL", async () => {
    currentSearch = "entityType=customer&entityId=42&action=update";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();

    const [entityTypeSelect, actionSelect] = screen.getAllByRole("combobox");
    expect(entityTypeSelect).toHaveTextContent("Customer");
    expect(screen.getByPlaceholderText("Entity ID…")).toHaveValue(42);
    expect(actionSelect).toHaveTextContent("Update");
    expect(getLastCallParams()).toEqual(
      expect.objectContaining({
        entityType: "customer",
        entityId: 42,
        action: "update",
      }),
    );
  });

  it("updates the URL through useLocation when a filter changes", async () => {
    currentSearch = "entityType=customer&entityId=42&action=update";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();
    const user = userEvent.setup();
    const [, actionSelect] = screen.getAllByRole("combobox");

    await user.click(actionSelect);
    await user.click(await screen.findByRole("option", { name: "Delete" }));

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenLastCalledWith(
        "/audit-logs?entityType=customer&entityId=42&action=delete",
        { replace: false },
      );
    });
  });

  it("copies the current browser URL when Copy link is clicked", async () => {
    const pathname = "/audit-logs?entityType=customer&entityId=42&action=update";
    window.history.replaceState({}, "", pathname);
    currentSearch = "entityType=customer&entityId=42&action=update";
    mockUseSearch.mockReturnValue(currentSearch);

    await renderAuditLogs();
    const user = userEvent.setup();
    const writeText = vi.spyOn(window.navigator.clipboard, "writeText");

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(window.location.href);
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

// ---------------------------------------------------------------------------
// Purge Now button tests
// ---------------------------------------------------------------------------

describe("Audit Logs — Purge Now button", () => {
  it("opens the confirm dialog when Purge Now is clicked", async () => {
    await renderAuditLogs();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /purge now/i }));

    expect(screen.getByText("Confirm Purge")).toBeInTheDocument();
    expect(screen.getByText(/This action cannot be undone/i)).toBeInTheDocument();
  });

  it("calls mutate when the 'Yes, purge now' confirmation button is clicked", async () => {
    const mockMutate = vi.fn();
    mockUsePurgeAuditLogs.mockReturnValue({ mutate: mockMutate, isPending: false });

    await renderAuditLogs();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /purge now/i }));
    await user.click(screen.getByRole("button", { name: /yes, purge now/i }));

    expect(mockMutate).toHaveBeenCalledOnce();
  });

  it("closes the dialog and does not call mutate when Cancel is clicked", async () => {
    const mockMutate = vi.fn();
    mockUsePurgeAuditLogs.mockReturnValue({ mutate: mockMutate, isPending: false });

    await renderAuditLogs();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /purge now/i }));
    expect(screen.getByText("Confirm Purge")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByText("Confirm Purge")).not.toBeInTheDocument();
    });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("disables the Purge Now button and shows 'Purging…' while the request is in flight", async () => {
    mockUsePurgeAuditLogs.mockReturnValue({ mutate: vi.fn(), isPending: true });

    await renderAuditLogs();

    const purgeButton = screen.getByRole("button", { name: /purging…/i });
    expect(purgeButton).toBeDisabled();
  });

  it("shows a toast with the plural deleted count on success", async () => {
    let capturedOnSuccess:
      | ((data: { deleted: number }) => void)
      | undefined;

    mockUsePurgeAuditLogs.mockImplementation(
      (opts: {
        mutation: { onSuccess: (data: { deleted: number }) => void };
      }) => {
        capturedOnSuccess = opts.mutation.onSuccess;
        return { mutate: vi.fn(), isPending: false };
      },
    );

    await renderAuditLogs();

    act(() => {
      capturedOnSuccess!({ deleted: 5 });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Purge complete",
          description: "5 records deleted.",
        }),
      );
    });
  });

  it("shows 'record' (singular) in the toast when exactly 1 record is deleted", async () => {
    let capturedOnSuccess:
      | ((data: { deleted: number }) => void)
      | undefined;

    mockUsePurgeAuditLogs.mockImplementation(
      (opts: {
        mutation: { onSuccess: (data: { deleted: number }) => void };
      }) => {
        capturedOnSuccess = opts.mutation.onSuccess;
        return { mutate: vi.fn(), isPending: false };
      },
    );

    await renderAuditLogs();

    act(() => {
      capturedOnSuccess!({ deleted: 1 });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Purge complete",
          description: "1 record deleted.",
        }),
      );
    });
  });

  it("shows a toast with '0 records deleted' when nothing was purged", async () => {
    let capturedOnSuccess:
      | ((data: { deleted: number }) => void)
      | undefined;

    mockUsePurgeAuditLogs.mockImplementation(
      (opts: {
        mutation: { onSuccess: (data: { deleted: number }) => void };
      }) => {
        capturedOnSuccess = opts.mutation.onSuccess;
        return { mutate: vi.fn(), isPending: false };
      },
    );

    await renderAuditLogs();

    act(() => {
      capturedOnSuccess!({ deleted: 0 });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Purge complete",
          description: "0 records deleted.",
        }),
      );
    });
  });
});
