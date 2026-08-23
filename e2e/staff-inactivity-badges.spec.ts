import { expect, test, type Page, type Route } from "@playwright/test";

const TEST_ADMIN = {
  id: "e2e-admin",
  name: "E2E Admin",
  email: "admin@example.test",
  role: "admin",
  emailVerified: true,
};

const DAY = 86_400_000;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function staffUser(
  id: string,
  name: string,
  lastActiveAt: string | null,
  active = true,
) {
  return {
    id,
    name,
    email: `${id}@example.test`,
    role: "support",
    active,
    createdAt: "2025-01-01T00:00:00.000Z",
    lastActiveAt,
  };
}

async function mockPortalApi(
  page: Page,
  users: ReturnType<typeof staffUser>[],
  deactivationRequests?: unknown[],
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === "/api/auth/get-session") {
      return json(route, {
        session: {
          id: "e2e-session",
          userId: TEST_ADMIN.id,
          expiresAt: "2099-01-01T00:00:00.000Z",
          token: "e2e-session-token",
        },
        user: TEST_ADMIN,
      });
    }

    if (pathname === "/api/setup/status") {
      return json(route, { complete: true });
    }

    if (pathname === "/api/users" && request.method() === "GET") {
      return json(route, { data: users });
    }

    if (pathname.startsWith("/api/users/") && request.method() === "PATCH") {
      deactivationRequests?.push({
        pathname,
        payload: request.postDataJSON(),
      });
      const userId = pathname.split("/").at(-1);
      const user = users.find((candidate) => candidate.id === userId);
      return json(route, { ...user, active: false });
    }

    return json(route, {});
  });
}

test("shows an amber inactivity badge for a staff account inactive for over 30 days", async ({ page }) => {
  const staleUser = staffUser(
    "stale-account",
    "Stale Account",
    new Date(Date.now() - 31 * DAY).toISOString(),
  );
  await mockPortalApi(page, [staleUser]);

  await page.goto("/staff");

  const row = page.getByRole("row", { name: /Stale Account/ });
  await expect(row.getByRole("button", { name: "Inactive 31d" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Inactive 31d" })).toHaveClass(/bg-amber-100/);
});

test("shows a red never-logged-in badge when a staff account has no activity", async ({ page }) => {
  const neverLoggedInUser = staffUser("never-active", "Never Active", null);
  await mockPortalApi(page, [neverLoggedInUser]);

  await page.goto("/staff");

  const row = page.getByRole("row", { name: /Never Active/ });
  await expect(row.getByRole("button", { name: "Never logged in" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Never logged in" })).toHaveClass(/bg-red-100/);
});

test("deactivates an active staff account when its inactivity badge is clicked", async ({ page }) => {
  const staleUser = staffUser(
    "stale-account",
    "Stale Account",
    new Date(Date.now() - 31 * DAY).toISOString(),
  );
  const deactivationRequests: unknown[] = [];
  await mockPortalApi(page, [staleUser], deactivationRequests);

  await page.goto("/staff");
  await page.getByRole("row", { name: /Stale Account/ })
    .getByRole("button", { name: "Inactive 31d" })
    .click();

  await expect.poll(() => deactivationRequests).toEqual([
    { pathname: "/api/users/stale-account", payload: { active: false } },
  ]);
});

test("does not show an inactivity badge for a recently active staff account", async ({ page }) => {
  const recentUser = staffUser(
    "recent-account",
    "Recent Account",
    new Date(Date.now() - 2 * DAY).toISOString(),
  );
  await mockPortalApi(page, [recentUser]);

  await page.goto("/staff");

  const row = page.getByRole("row", { name: /Recent Account/ });
  await expect(row.getByText("2d ago")).toBeVisible();
  await expect(row.getByText(/^Inactive \d+d$/)).toHaveCount(0);
  await expect(row.getByText("Never logged in")).toHaveCount(0);
});