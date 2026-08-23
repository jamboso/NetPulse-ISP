import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangePasswordSection } from "@/components/ChangePasswordSection";

const mockChangePassword = vi.fn();

vi.mock("@/lib/authClient", () => ({
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function fillForm({
  current = "",
  next = "",
  confirm = "",
}: {
  current?: string;
  next?: string;
  confirm?: string;
}) {
  const user = userEvent.setup();
  return {
    user,
    async fill() {
      if (current) await user.type(screen.getByPlaceholderText("Enter current password"), current);
      if (next)    await user.type(screen.getByPlaceholderText("Enter new password"), next);
      if (confirm) await user.type(screen.getByPlaceholderText("Re-enter new password"), confirm);
    },
    async submit() {
      await user.click(screen.getByRole("button", { name: /change password/i }));
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Wrong current password — server rejects it
// ---------------------------------------------------------------------------
describe("ChangePasswordSection — wrong current password", () => {
  it("displays the error message returned by the server when the current password is wrong", async () => {
    mockChangePassword.mockResolvedValueOnce({ error: { message: "Invalid password" } });

    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "wrong-password",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    await fill();
    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid password");
    });
    expect(mockChangePassword).toHaveBeenCalledOnce();
  });

  it("displays a fallback message when the server returns an error without a message", async () => {
    mockChangePassword.mockResolvedValueOnce({ error: {} });

    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "wrong-password",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    await fill();
    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Failed to change password. Check your current password and try again.",
      );
    });
  });

  it("displays a generic message when the changePassword call throws unexpectedly", async () => {
    mockChangePassword.mockRejectedValueOnce(new Error("Network error"));

    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "any-password",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    await fill();
    await submit();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Mismatched new / confirm passwords — client-side guard
// ---------------------------------------------------------------------------
describe("ChangePasswordSection — client-side validation", () => {
  it("shows 'New passwords do not match.' when confirm differs from new password", async () => {
    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "CurrentPass1!",
      next: "NewPass123!",
      confirm: "DifferentPass!",
    });
    await fill();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("New passwords do not match.");
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("shows an error when the new password is shorter than 8 characters", async () => {
    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "CurrentPass1!",
      next: "short",
      confirm: "short",
    });
    await fill();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent("New password must be at least 8 characters.");
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("shows an error when the new password is the same as the current password", async () => {
    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "SamePass1!",
      next: "SamePass1!",
      confirm: "SamePass1!",
    });
    await fill();
    await submit();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "New password must be different from your current password.",
    );
    expect(mockChangePassword).not.toHaveBeenCalled();
  });

  it("does not call changePassword and does not show an error before any interaction", () => {
    render(<ChangePasswordSection />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockChangePassword).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Valid credentials — successful password change
// ---------------------------------------------------------------------------
describe("ChangePasswordSection — successful password change", () => {
  it("renders the sign-out-other-devices checkbox unchecked by default", () => {
    render(<ChangePasswordSection />);

    expect(screen.getByRole("checkbox", { name: /sign out all other devices/i })).not.toBeChecked();
  });

  it("shows 'Password changed successfully.' after a valid password change", async () => {
    mockChangePassword.mockResolvedValueOnce({ status: true });

    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "OldPass1!",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    await fill();
    await submit();

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Password changed successfully.");
    });
  });

  it("clears all password fields after a successful change", async () => {
    mockChangePassword.mockResolvedValueOnce({ status: true });

    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "OldPass1!",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    await fill();
    await submit();

    await waitFor(() => {
      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Enter current password")).toHaveValue("");
    expect(screen.getByPlaceholderText("Enter new password")).toHaveValue("");
    expect(screen.getByPlaceholderText("Re-enter new password")).toHaveValue("");
  });

  it("calls changePassword with the correct arguments", async () => {
    mockChangePassword.mockResolvedValueOnce({ status: true });

    render(<ChangePasswordSection />);

    const { fill, submit } = fillForm({
      current: "OldPass1!",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    await fill();
    await submit();

    await waitFor(() => expect(mockChangePassword).toHaveBeenCalledOnce());

    expect(mockChangePassword).toHaveBeenCalledWith({
      currentPassword: "OldPass1!",
      newPassword: "NewValid1!",
      revokeOtherSessions: false,
    });
  });

  it("revokes other sessions and confirms they were signed out when selected", async () => {
    mockChangePassword.mockResolvedValueOnce({ status: true });

    render(<ChangePasswordSection />);

    const { user, fill, submit } = fillForm({
      current: "OldPass1!",
      next: "NewValid1!",
      confirm: "NewValid1!",
    });
    const revokeSessions = screen.getByRole("checkbox", { name: /sign out all other devices/i });

    await user.click(revokeSessions);
    expect(revokeSessions).toBeChecked();

    await fill();
    await submit();

    await waitFor(() => {
      expect(mockChangePassword).toHaveBeenCalledWith({
        currentPassword: "OldPass1!",
        newPassword: "NewValid1!",
        revokeOtherSessions: true,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("All other devices have been signed out.");
  });
});
