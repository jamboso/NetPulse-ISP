import { defineConfig, devices } from "@playwright/test";

const portalUrl = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: portalUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm --filter @workspace/isp-portal exec vite --config vite.config.ts --host 127.0.0.1 --port 4173",
    url: portalUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});