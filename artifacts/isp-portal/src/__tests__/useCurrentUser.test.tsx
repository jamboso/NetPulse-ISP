import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUseSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authClient", () => ({ useSession: mockUseSession }));

const { useCurrentUser } = await import("../hooks/useCurrentUser");

describe("useCurrentUser", () => {
  it("gives an owner Network management access", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "owner-1", role: "owner" } },
      isPending: false,
    });

    const { result } = renderHook(() => useCurrentUser());

    expect(result.current.isOwner).toBe(true);
    expect(result.current.canManageNetwork).toBe(true);
  });
});