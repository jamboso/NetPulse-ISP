import { expect, test, type Page, type Route } from "@playwright/test";

const TEST_USER = {
  id: "e2e-owner",
  name: "E2E Owner",
  email: "owner@example.test",
  role: "owner",
  emailVerified: true,
};

let changePasswordRequests = 0;
let lastChangePasswordPayload: unknown;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockPortalApi(page: Page) {
  changePasswordRequests = 0;
  lastChangePasswordPayload = undefined;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === "/api/auth/get-session") {
      return json(route, {
        session: {
          id: "e2e-session",
          userId: TEST_USER.id,
          expiresAt: "2099-01-01T00:00:00.000Z",
          token: "e2e-session-token",
        },
        user: TEST_USER,
      });
    }

    if (pathname === "/api/setup/status") {
      return json(route, { complete: true });
    }

    if (pathname === "/api/settings" && request.method() === "GET") {
      return json(route, {});
    }

    if (pathname === "/api/auth/change-password" && request.method() === "POST") {
      changePasswordRequests += 1;
      lastChangePasswordPayload = request.postDataJSON();

      const payload = lastChangePasswordPayload as { currentPassword?: string };
      if (payload.currentPassword !== "CurrentPass1!") {
        return json(route, {
          code: "INVALID_PASSWORD",
          message: "Invalid password",
        }, 400);
      }

      return json(route, { status: true });
    }

    return json(route, {});
  });
}

async function openChangePasswordForm(page: Page) {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("tab", { name: /account/i }).click();
  await expect(page.getByRole("heading", { name: "Change Password" })).toBeVisible();
}

function changePasswordForm(page: Page) {
  return page.locator("form").filter({
    has: page.getByPlaceholder("Re-enter new password"),
  });
}

async function fillPasswordForm(
  page: Page,
  {
    currentPassword,
    newPassword,
    confirmPassword,
  }: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  },
) {
  const form = changePasswordForm(page);
  await form.getByPlaceholder("Enter current password").fill(currentPassword);
  await form.getByPlaceholder("Enter new password", { exact: true }).fill(newPassword);
  await form.getByPlaceholder("Re-enter new password").fill(confirmPassword);
}

test.beforeEach(async ({ page }) => {
  await mockPortalApi(page);
  await openChangePasswordForm(page);
});

test("shows the server error after submitting an incorrect current password", async ({ page }) => {
  await fillPasswordForm(page, {
    currentPassword: "WrongPass1!",
    newPassword: "NewValidPass1!",
    confirmPassword: "NewValidPass1!",
  });

  await changePasswordForm(page).getByRole("button", { name: "Change Password" }).click();

  await expect(changePasswordForm(page).getByRole("alert")).toHaveText("Invalid password");
  await expect.poll(() => changePasswordRequests).toBe(1);
  expect(lastChangePasswordPayload).toMatchObject({
    currentPassword: "WrongPass1!",
    newPassword: "NewValidPass1!",
  });
});

test("shows a client-side error when new and confirmed passwords differ", async ({ page }) => {
  await fillPasswordForm(page, {
    currentPassword: "CurrentPass1!",
    newPassword: "NewValidPass1!",
    confirmPassword: "DifferentPass1!",
  });

  await changePasswordForm(page).getByRole("button", { name: "Change Password" }).click();

  await expect(changePasswordForm(page).getByRole("alert")).toHaveText("New passwords do not match.");
  expect(changePasswordRequests).toBe(0);
});

test("shows success and clears fields after a valid password change", async ({ page }) => {
  await fillPasswordForm(page, {
    currentPassword: "CurrentPass1!",
    newPassword: "NewValidPass1!",
    confirmPassword: "NewValidPass1!",
  });

  const form = changePasswordForm(page);
  await form.getByRole("button", { name: "Change Password" }).click();

  await expect(form.getByRole("status")).toHaveText("Password changed successfully.");
  await expect(form.getByPlaceholder("Enter current password")).toHaveValue("");
  await expect(form.getByPlaceholder("Enter new password", { exact: true })).toHaveValue("");
  await expect(form.getByPlaceholder("Re-enter new password")).toHaveValue("");
  await expect.poll(() => changePasswordRequests).toBe(1);
  expect(lastChangePasswordPayload).toMatchObject({
    currentPassword: "CurrentPass1!",
    newPassword: "NewValidPass1!",
  });
});