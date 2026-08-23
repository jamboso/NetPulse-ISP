import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "@/App";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/lib/authClient", () => ({
  signOut: vi.fn(),
  useSession: () => mocks.useSession(),
}));

vi.mock("@/components/layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/toaster", () => ({
  Toaster: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/pages/dashboard", () => ({
  default: () => <div>Dashboard page</div>,
}));

vi.mock("@/pages/pppoe-setup", () => ({
  default: () => <div>PPPoE page</div>,
}));

vi.mock("@/pages/hotspot-manager", () => ({
  default: () => <div>Hotspot page</div>,
}));

vi.mock("@/pages/mpesa-transactions", () => ({
  default: () => <div>M-Pesa page</div>,
}));

vi.mock("@/pages/settings", () => ({
  default: () => <div>Settings page</div>,
}));

function sessionFor(role: string) {
  return {
    data: { user: { id: "u1", name: "Test User", email: "test@example.com", role } },
    isPending: false,
  };
}

function renderAt(path: string, role: string) {
  window.history.replaceState({}, "", path);
  mocks.useSession.mockReturnValue(sessionFor(role));
  return render(<App />);
}

async function expectRedirectedToDashboard() {
  await waitFor(() => {
    expect(window.location.pathname).toBe("/");
  });
  expect(screen.getByText("Dashboard page")).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({ complete: true }),
    }),
  );
});

describe("App route guards", () => {
  it("shows an access-denied toast and redirects a billing user from Settings to the dashboard", async () => {
    renderAt("/settings", "billing");

    await expectRedirectedToDashboard();
    expect(screen.queryByText("Settings page")).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Access Denied",
      description: "This page requires one of the following roles: owner, Admin.",
      variant: "destructive",
    });
  });

  it("blocks a billing user from the PPPoE router route", async () => {
    renderAt("/network/routers/42/pppoe", "billing");

    await expectRedirectedToDashboard();
    expect(screen.queryByText("PPPoE page")).not.toBeInTheDocument();
  });

  it("allows a technician to open the PPPoE router route", async () => {
    renderAt("/network/routers/42/pppoe", "technician");

    expect(await screen.findByText("PPPoE page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/network/routers/42/pppoe");
  });

  it("blocks a billing user from the Hotspot router route", async () => {
    renderAt("/network/routers/42/hotspot", "billing");

    await expectRedirectedToDashboard();
    expect(screen.queryByText("Hotspot page")).not.toBeInTheDocument();
  });

  it("allows a technician to open the Hotspot router route", async () => {
    renderAt("/network/routers/42/hotspot", "technician");

    expect(await screen.findByText("Hotspot page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/network/routers/42/hotspot");
  });

  it.each(["support", "technician"])(
    "blocks a %s user from the M-Pesa route",
    async (role) => {
      renderAt("/mpesa", role);

      await expectRedirectedToDashboard();
      expect(screen.queryByText("M-Pesa page")).not.toBeInTheDocument();
    },
  );

  it("allows a billing user to open the M-Pesa route", async () => {
    renderAt("/mpesa", "billing");

    expect(await screen.findByText("M-Pesa page")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/mpesa");
  });
});