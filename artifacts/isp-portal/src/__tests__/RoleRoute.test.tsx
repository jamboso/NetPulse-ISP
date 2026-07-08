import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RoleRoute } from "@/components/RoleRoute";

const mockSetLocation = vi.fn();

vi.mock("wouter", () => ({
  useLocation: () => ["/", mockSetLocation],
}));

const mockUseSession = vi.fn();

vi.mock("@/lib/authClient", () => ({
  useSession: () => mockUseSession(),
}));

function MockPage() {
  return <div>Page Content</div>;
}

function sessionFor(role: string) {
  return {
    data: { user: { id: "u1", name: "Test User", email: "test@example.com", role } },
    isPending: false,
  };
}

const pendingSession = { data: null, isPending: true };
const noSession = { data: null, isPending: false };

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pending state
// ---------------------------------------------------------------------------
describe("RoleRoute — loading state", () => {
  it("renders nothing while session is loading", () => {
    mockUseSession.mockReturnValue(pendingSession);

    const { container } = render(
      <RoleRoute component={MockPage} roles={["admin"]} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("does not redirect while session is loading", () => {
    mockUseSession.mockReturnValue(pendingSession);

    render(<RoleRoute component={MockPage} roles={["admin"]} />);

    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// No session (unauthenticated)
// ---------------------------------------------------------------------------
describe("RoleRoute — no session", () => {
  it("renders nothing when there is no session", () => {
    mockUseSession.mockReturnValue(noSession);

    const { container } = render(
      <RoleRoute component={MockPage} roles={["admin"]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("does not redirect when there is no session (AuthGuard handles that)", () => {
    mockUseSession.mockReturnValue(noSession);

    render(<RoleRoute component={MockPage} roles={["admin"]} />);

    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admin — full access
// ---------------------------------------------------------------------------
describe("RoleRoute — admin role", () => {
  it("renders the page for an admin on a network route", async () => {
    mockUseSession.mockReturnValue(sessionFor("admin"));

    render(<RoleRoute component={MockPage} roles={["admin", "technician"]} />);

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("renders the page for an admin on a billing route", () => {
    mockUseSession.mockReturnValue(sessionFor("admin"));

    render(<RoleRoute component={MockPage} roles={["admin", "billing"]} />);

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("renders the page for an admin on an admin-only route", () => {
    mockUseSession.mockReturnValue(sessionFor("admin"));

    render(<RoleRoute component={MockPage} roles={["admin"]} />);

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Billing role — allowed pages
// ---------------------------------------------------------------------------
describe("RoleRoute — billing role: allowed pages", () => {
  it("renders the page for a billing user on /invoices", () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("renders the page for a billing user on /payments", () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("renders the page for a billing user on /customers", () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing", "support"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Billing role — blocked pages
// ---------------------------------------------------------------------------
describe("RoleRoute — billing role: blocked pages", () => {
  it("redirects a billing user away from /network (technician/admin only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "technician"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a billing user away from /tickets (admin/support only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "support"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a billing user away from /staff (admin only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(<RoleRoute component={MockPage} roles={["admin"]} />);

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Support role — allowed pages
// ---------------------------------------------------------------------------
describe("RoleRoute — support role: allowed pages", () => {
  it("renders the page for a support user on /tickets", () => {
    mockUseSession.mockReturnValue(sessionFor("support"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "support"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("renders the page for a support user on /customers", () => {
    mockUseSession.mockReturnValue(sessionFor("support"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing", "support"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Support role — blocked pages
// ---------------------------------------------------------------------------
describe("RoleRoute — support role: blocked pages", () => {
  it("redirects a support user away from /invoices (admin/billing only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("support"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a support user away from /payments (admin/billing only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("support"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a support user away from /network (admin/technician only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("support"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "technician"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a support user away from /staff (admin only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("support"));

    render(<RoleRoute component={MockPage} roles={["admin"]} />);

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Technician role — allowed pages
// ---------------------------------------------------------------------------
describe("RoleRoute — technician role: allowed pages", () => {
  it("renders the page for a technician on /network", () => {
    mockUseSession.mockReturnValue(sessionFor("technician"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "technician"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });

  it("renders the page for a technician on /monitoring", () => {
    mockUseSession.mockReturnValue(sessionFor("technician"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "technician"]} />,
    );

    expect(screen.getByText("Page Content")).toBeInTheDocument();
    expect(mockSetLocation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Technician role — blocked pages
// ---------------------------------------------------------------------------
describe("RoleRoute — technician role: blocked pages", () => {
  it("redirects a technician away from /customers (admin/billing/support only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("technician"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing", "support"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a technician away from /invoices (admin/billing only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("technician"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "billing"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a technician away from /tickets (admin/support only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("technician"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "support"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });

  it("redirects a technician away from /staff (admin only)", async () => {
    mockUseSession.mockReturnValue(sessionFor("technician"));

    render(<RoleRoute component={MockPage} roles={["admin"]} />);

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
    expect(screen.queryByText("Page Content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Redirect target is always the dashboard ("/")
// ---------------------------------------------------------------------------
describe("RoleRoute — redirect destination", () => {
  it("always redirects to '/' (dashboard), not any other path", async () => {
    mockUseSession.mockReturnValue(sessionFor("billing"));

    render(
      <RoleRoute component={MockPage} roles={["admin", "technician"]} />,
    );

    await waitFor(() => {
      expect(mockSetLocation).toHaveBeenCalledTimes(1);
      expect(mockSetLocation).toHaveBeenCalledWith("/");
    });
  });
});
