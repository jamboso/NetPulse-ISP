import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockCurrentUser = vi.hoisted(() => vi.fn());
const mockLocation = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: mockCurrentUser }));
vi.mock("@/lib/authClient", () => ({ signOut: vi.fn() }));
vi.mock("@/components/customer-search", () => ({
  CustomerSearch: () => <div data-testid="customer-search" />,
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
  useLocation: mockLocation,
}));

const { CustomerWorkspaceSidebar } = await import("../components/customer-workspace-sidebar");
const { default: Layout } = await import("../components/layout");

function user(overrides: Record<string, unknown> = {}) {
  return {
    name: "Admin",
    email: "admin@example.com",
    role: "admin",
    isOwner: false,
    isAdmin: true,
    canManageBilling: true,
    canManageCustomers: true,
    canManageTickets: true,
    canManageNetwork: true,
    ...overrides,
  };
}

describe("Customer workspace navigation", () => {
  it("places Network, Monitoring, and Network Map in the customer workspace for admins", () => {
    mockCurrentUser.mockReturnValue(user());
    mockLocation.mockReturnValue(["/customers", vi.fn()]);

    render(<CustomerWorkspaceSidebar />);

    expect(screen.getByRole("navigation", { name: "Customer workspace navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Customers" })).toHaveAttribute("href", "/customers");
    expect(screen.getByRole("link", { name: "Network" })).toHaveAttribute("href", "/network");
    expect(screen.getByRole("link", { name: "Monitoring" })).toHaveAttribute("href", "/monitoring");
    expect(screen.getByRole("link", { name: "Network Map" })).toHaveAttribute("href", "/map");
  });

  it("does not duplicate those links in an admin's main sidebar", () => {
    mockCurrentUser.mockReturnValue(user());
    mockLocation.mockReturnValue(["/customers", vi.fn()]);

    render(<Layout><div>Page content</div></Layout>);

    expect(screen.queryByRole("link", { name: "Network" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Monitoring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Network Map" })).not.toBeInTheDocument();
  });

  it("keeps the network links available in the main sidebar for technicians", () => {
    mockCurrentUser.mockReturnValue(user({
      role: "technician",
      isAdmin: false,
      canManageBilling: false,
      canManageCustomers: false,
      canManageTickets: false,
    }));
    mockLocation.mockReturnValue(["/network", vi.fn()]);

    render(<Layout><div>Page content</div></Layout>);

    expect(screen.getByRole("link", { name: "Network" })).toHaveAttribute("href", "/network");
    expect(screen.getByRole("link", { name: "Monitoring" })).toHaveAttribute("href", "/monitoring");
    expect(screen.getByRole("link", { name: "Network Map" })).toHaveAttribute("href", "/map");
  });
});