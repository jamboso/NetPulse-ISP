import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCurrentUser = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useListEquipment: vi.fn(),
  useCreateEquipment: vi.fn(),
  useUpdateEquipment: vi.fn(),
  useDeleteEquipment: vi.fn(),
  useListIpPools: vi.fn(),
  useCreateIpPool: vi.fn(),
  useUpdateIpPool: vi.fn(),
  useDeleteIpPool: vi.fn(),
  useListRouters: vi.fn(),
  useCreateRouter: vi.fn(),
  useUpdateRouter: vi.fn(),
  useDeleteRouter: vi.fn(),
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: mockCurrentUser }));
vi.mock("@/hooks/useMacVendor", () => ({ useMacVendor: () => ({}) }));
vi.mock("@/components/fiber-access-workspace", () => ({
  FiberAccessWorkspace: () => <div>Fiber access workspace</div>,
}));

const { RouterProvisionPanel } = await import("../pages/network");

const provisionInfo = {
  id: 17,
  name: "MAJE_TEMP",
  routerType: "routeros",
  provisionToken: "fresh-bootstrap-token",
  provisionStatus: "pending",
  macAddress: null,
  rosVersion: "7.19.6",
  vpnConnected: false,
  vpnIp: "10.8.0.7",
  lastCallbackAt: null,
};

describe("RouterProvisionPanel VPN repair", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCurrentUser.mockReturnValue({ isAdmin: false, isOwner: true });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("lets an owner repair the central VPN service and shows the safe result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => provisionInfo })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          state: "repaired",
          message: "NetPulse VPN service is ready for RouterOS onboarding.",
          events: ["Managed OpenVPN service is active and owns TCP 1194."],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => provisionInfo });
    vi.stubGlobal("fetch", fetchMock);

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    fireEvent.click(screen.getByRole("button", { name: "Repair VPN Service" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/infrastructure/vpn/repair-service", {
        method: "POST",
        credentials: "include",
      });
    });
    expect(await screen.findByText("NetPulse VPN service is ready for RouterOS onboarding.")).toBeInTheDocument();
    expect(screen.getByText("Repair details")).toBeInTheDocument();
  });

  it("shows the service-restart control to an administrator", async () => {
    mockCurrentUser.mockReturnValue({ isAdmin: true, isOwner: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => provisionInfo }));

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    expect(screen.getByRole("button", { name: "Repair VPN Service" })).toBeEnabled();
  });

  it("does not show the service-restart control to a technician", async () => {
    mockCurrentUser.mockReturnValue({ isAdmin: false, isOwner: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => provisionInfo }));

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    expect(screen.queryByRole("button", { name: "Repair VPN Service" })).not.toBeInTheDocument();
  });

  it("shows the locked command console and explains the VPN requirement while pending", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => provisionInfo }));

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    expect(screen.getByText("Command console locked")).toBeInTheDocument();
    expect(screen.getByText(/Connect this router’s private management VPN/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Command Console" })).toBeDisabled();
  });

  it("requires confirmation before calling the central repair service", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => provisionInfo });
    vi.stubGlobal("fetch", fetchMock);

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    fireEvent.click(screen.getByRole("button", { name: "Repair VPN Service" }));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(window.confirm).toHaveBeenCalledOnce();
  });

  it("explains the safe legacy migration when a dedicated VPN service is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => provisionInfo })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          success: false,
          state: "unavailable",
          message: "Dedicated NetPulse VPN configuration was not found. Do not repair a generic OpenVPN service; migrate the verified legacy NetPulse service first.",
          events: [],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    fireEvent.click(screen.getByRole("button", { name: "Repair VPN Service" }));

    expect(await screen.findByText(/Dedicated NetPulse VPN configuration was not found/)).toBeInTheDocument();
    expect(screen.getByText(/migrate-legacy-routeros-vpn\.sh/)).toBeInTheDocument();
    expect(screen.getByText(/not Tabana-VPN/)).toBeInTheDocument();
  });

  it("prevents concurrent repair requests while a repair is running", async () => {
    let resolveRepair: (value: unknown) => void = () => undefined;
    const repairResponse = new Promise((resolve) => { resolveRepair = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => provisionInfo })
      .mockReturnValueOnce(repairResponse);
    vi.stubGlobal("fetch", fetchMock);

    render(<RouterProvisionPanel routerId={17} routerName="MAJE_TEMP" />);

    await screen.findByText("Awaiting provisioning");
    const button = screen.getByRole("button", { name: "Repair VPN Service" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRepair({
      ok: true,
      json: async () => ({
        success: true,
        state: "healthy",
        message: "NetPulse VPN service is already healthy.",
        events: [],
      }),
    });
    expect(await screen.findByText("NetPulse VPN service is already healthy.")).toBeInTheDocument();
  });
});