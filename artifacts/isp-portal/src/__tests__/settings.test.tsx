import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockUseGetSettings = vi.fn();
const mockUseUpdateSettings = vi.fn();
const mockUseCurrentUser = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  useGetSettings: () => mockUseGetSettings(),
  useUpdateSettings: () => mockUseUpdateSettings(),
  useSendTestEmail: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendAuditLogExportNow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetMpesaIpAllowlist: () => ({ data: undefined, isLoading: false }),
  useGetCompanyMpesaSettings: () => ({ data: undefined, isLoading: false }),
  useUpdateCompanyMpesaSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}));

vi.mock("../pages/infrastructure-tab", () => ({
  InfrastructureTab: () => null,
}));

vi.mock("../pages/updates-tab", () => ({
  UpdatesTab: () => null,
}));

vi.mock("../pages/ai-assistant-tab", () => ({
  AiAssistantTab: () => null,
}));

function TestProvider({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCurrentUser.mockReturnValue({ isAdmin: false, isOwner: true });
  mockUseGetSettings.mockReturnValue({
    data: {
      exportScheduleEnabled: "0",
      exportScheduleFrequency: "weekly",
      exportScheduleEmail: "",
    },
    isLoading: false,
  });
});

describe("Settings — scheduled audit log export", () => {
  it("renders in Notifications and saves its schedule settings", async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    mockUseUpdateSettings.mockReturnValue({ mutateAsync, isPending: false });

    const { default: Settings } = await import("../pages/settings");
    render(<Settings />, { wrapper: TestProvider });
    const user = userEvent.setup();

    await user.click(screen.getByRole("tab", { name: /notifications/i }));

    expect(screen.getByText("Scheduled Audit Log Export")).toBeInTheDocument();
    expect(screen.getByText("Enable Scheduled Export")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Weekly");

    await user.click(screen.getByRole("switch"));
    await user.type(
      screen.getByPlaceholderText("compliance@myisp.co.ke"),
      "compliance@example.com",
    );
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        data: {
          exportScheduleEnabled: "1",
          exportScheduleEmail: "compliance@example.com",
        },
      });
    });
  });
});