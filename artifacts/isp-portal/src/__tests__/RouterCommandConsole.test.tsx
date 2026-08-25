import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockCurrentUser = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: mockCurrentUser }));

const { RouterCommandConsole } = await import("../components/router-command-console");

describe("RouterCommandConsole", () => {
  it("is unavailable to non-admin users", () => {
    mockCurrentUser.mockReturnValue({ isAdmin: false, isOwner: false });
    render(<RouterCommandConsole routerId={17} routerName="MAJE_TEMP" vpnConnected sshHostKey="SHA256:verifiedRouterKey" />);

    expect(screen.getByRole("button", { name: "Command Console" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Command Console" })).toHaveAttribute(
      "title",
      "Only administrators and owners can use the router command console.",
    );
  });

  it("requires a connected private VPN before opening the console", () => {
    mockCurrentUser.mockReturnValue({ isAdmin: true, isOwner: false });
    render(<RouterCommandConsole routerId={17} routerName="MAJE_TEMP" vpnConnected={false} sshHostKey="SHA256:verifiedRouterKey" />);

    const button = screen.getByRole("button", { name: "Command Console" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Connect the router’s private management VPN before opening the console.");
  });

  it("opens for an administrator when the VPN is connected", () => {
    mockCurrentUser.mockReturnValue({ isAdmin: true, isOwner: false });
    render(<RouterCommandConsole routerId={17} routerName="MAJE_TEMP" vpnConnected sshHostKey="SHA256:verifiedRouterKey" />);

    fireEvent.click(screen.getByRole("button", { name: "Command Console" }));
    expect(screen.getByRole("heading", { name: "MAJE_TEMP command console" })).toBeInTheDocument();
    expect(screen.getByText(/Commands run over the router’s private management VPN/i)).toBeInTheDocument();
  });

  it("opens for an owner when the VPN is connected", () => {
    mockCurrentUser.mockReturnValue({ isAdmin: false, isOwner: true });
    render(<RouterCommandConsole routerId={17} routerName="MAJE_TEMP" vpnConnected sshHostKey="SHA256:verifiedRouterKey" />);

    fireEvent.click(screen.getByRole("button", { name: "Command Console" }));
    expect(screen.getByRole("heading", { name: "MAJE_TEMP command console" })).toBeInTheDocument();
  });
});