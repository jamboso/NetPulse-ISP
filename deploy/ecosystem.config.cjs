/**
 * PM2 ecosystem config — production process manager for NetPulse API server.
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Env loading strategy (belt-and-suspenders):
 *  1. The CJS module parses /opt/netpulse/.env with Node fs so PM2 can read
 *     PORT/FRONTEND_DIST_PATH for the env{} block below.
 *  2. The spawned Node.js 20.6+ process receives --env-file so the runtime
 *     itself loads DATABASE_URL, BETTER_AUTH_SECRET, etc. natively — no
 *     third-party dotenv package required.
 */

const fs = require("fs");
const ENV_FILE = "/opt/netpulse/.env";

// Simple .env parser — no external deps
const envFromFile = {};
try {
  fs.readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
      if (!m) return;
      // Strip optional surrounding quotes
      const val = m[2].replace(/^(['"])(.*)\1$/, "$2");
      envFromFile[m[1]] = val;
    });
} catch (_) {}

module.exports = {
  apps: [
    {
      name: "netpulse",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/opt/netpulse",
      instances: 1,
      exec_mode: "fork",
      // --env-file lets Node.js 20.6+ natively load .env before the script runs
      node_args: "--enable-source-maps --env-file /opt/netpulse/.env",
      env: {
        NODE_ENV:           "production",
        PORT:               envFromFile.PORT               || "8080",
        FRONTEND_DIST_PATH: envFromFile.FRONTEND_DIST_PATH
                            || "/opt/netpulse/artifacts/isp-portal/dist/public",
      },
      max_restarts:  5,
      min_uptime:    "5s",
      restart_delay: 3000,
      out_file:        "/var/log/netpulse/out.log",
      error_file:      "/var/log/netpulse/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
