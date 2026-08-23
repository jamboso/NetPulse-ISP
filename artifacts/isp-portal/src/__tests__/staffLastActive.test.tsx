import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockUseListUsers = vi.fn();
const mockUseCreateUser = vi.fn();
const mockUseUpdateUser = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useListUsers: (...args: unknown[]) => mockUseListUsers(...args),
  useCreateUser: (...args: unknown[]) => mockUseCreateUser(...args),
  useUpdateUser: (...args: unknown[]) => mockUseUpdateUser(...args),
  getListUsersQueryKey: vi.fn(() => ["/api/users"]),
  useGetWelcomeEmailPreview: vi.fn(() => ({ data: null, isLoading: false })),
  useSendWelcomeEmailTest: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  getGetWelcomeEmailPreviewQueryKey: vi.fn(() => ["/api/welcome-email-preview"]),
}));

vi.mock("@/hooks/useBulkSelect", () => ({
  useBulkSelect: vi.fn(() => ({
    selected: new Set<string>(),
    toggle: vi.fn(),
    toggleAll: vi.fn(),
    clear: vi.fn(),
    isAllSelected: false,
    isIndeterminate: false,
  })),
}));

vi.mock("@/components/BulkActionBar", () => ({
  BulkActionBar: () => null,
}));

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    name: "Alice Admin",
    email: "alice@example.com",
    role: "admin" as const,
    active: true,
    createdAt: new Date(2025, 0, 1).toISOString(),
    lastActiveAt: null as string | null,
    ...overrides,
  };
}

function setupMutations() {
  mockUseCreateUser.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseUpdateUser.mockReturnValue({ mutate: vi.fn(), isPending: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMutations();
});

async function renderStaffPage() {
  const { default: StaffPage } = await import("../pages/staff");
  return render(<StaffPage />, { wrapper });
}

describe("Staff page — Last Active column header", () => {
  it("renders the 'Last Active' column header", async () => {
    mockUseListUsers.mockReturnValue({ data: { data: [] }, isLoading: false });

    await renderStaffPage();

    expect(screen.getByText("Last Active")).toBeInTheDocument();
  });
});

describe("Staff page — Last Active column: recent session", () => {
  it("shows 'Just now' for a session recorded seconds ago", async () => {
    const recentDate = new Date(Date.now() - 30_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: recentDate })] },
      isLoading: false,
    });

    await renderStaffPage();

    expect(screen.getByText("Just now")).toBeInTheDocument();
  });

  it("applies non-muted text color for a recent session", async () => {
    const recentDate = new Date(Date.now() - 30_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: recentDate })] },
      isLoading: false,
    });

    await renderStaffPage();

    const el = screen.getByText("Just now");
    expect(el).toHaveClass("text-gray-700");
    expect(el).not.toHaveClass("text-gray-400");
  });

  it("shows the full locale timestamp in a styled tooltip on hover", async () => {
    const lastActiveAt = new Date(Date.now() - 5 * 60_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt })] },
      isLoading: false,
    });

    await renderStaffPage();
    await userEvent.setup().hover(screen.getByText("5m ago"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(new Date(lastActiveAt).toLocaleString());
  });

  it("shows 'Xm ago' for a session a few minutes ago", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: fiveMinutesAgo })] },
      isLoading: false,
    });

    await renderStaffPage();

    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  it("applies non-muted text color for a session a few minutes ago", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: fiveMinutesAgo })] },
      isLoading: false,
    });

    await renderStaffPage();

    const el = screen.getByText("5m ago");
    expect(el).toHaveClass("text-gray-700");
    expect(el).not.toHaveClass("text-gray-400");
  });
});

describe("Staff page — Last Active column: no sessions", () => {
  it("shows 'Never' for a user with no session record", async () => {
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: null })] },
      isLoading: false,
    });

    await renderStaffPage();

    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("applies muted text color (text-gray-400) for 'Never'", async () => {
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: null })] },
      isLoading: false,
    });

    await renderStaffPage();

    const el = screen.getByText("Never");
    expect(el).toHaveClass("text-gray-400");
    expect(el).not.toHaveClass("text-gray-700");
  });

  it("explains the absence of sessions in a styled tooltip on hover", async () => {
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: null })] },
      isLoading: false,
    });

    await renderStaffPage();
    await userEvent.setup().hover(screen.getByText("Never"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("No sessions have been recorded.");
  });
});

describe("Staff page — Last Active column: old session", () => {
  it("shows a relative time for a session 40 days ago", async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: fortyDaysAgo })] },
      isLoading: false,
    });

    await renderStaffPage();

    expect(screen.getByText("1mo ago")).toBeInTheDocument();
  });

  it("applies muted text color for an old session (> 30 days)", async () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    mockUseListUsers.mockReturnValue({
      data: { data: [makeUser({ lastActiveAt: fortyDaysAgo })] },
      isLoading: false,
    });

    await renderStaffPage();

    const el = screen.getByText("1mo ago");
    expect(el).toHaveClass("text-gray-400");
    expect(el).not.toHaveClass("text-gray-700");
  });
});

describe("Staff page — Last Active column: multiple users", () => {
  it("renders Last Active correctly for multiple users side by side", async () => {
    const recentDate = new Date(Date.now() - 30_000).toISOString();
    const users = [
      makeUser({ id: "u1", name: "Alice", lastActiveAt: recentDate }),
      makeUser({ id: "u2", name: "Bob", lastActiveAt: null }),
    ];
    mockUseListUsers.mockReturnValue({
      data: { data: users },
      isLoading: false,
    });

    await renderStaffPage();

    expect(screen.getByText("Just now")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
  });
});
