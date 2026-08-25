/**
 * PM2 ecosystem config — production process manager for NetPulse API server.
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * All required env vars are passed explicitly via the env{} block so the app
 * always gets them regardless of Node.js --env-file flag support.
 */

const fs   = require("fs");
const path = require("path");

const APP_DIR  = "/opt/netpulse";
const ENV_FILE = path.join(APP_DIR, ".env");

// Simple .env parser — no external deps needed
const envFromFile = {};
try {
  fs.readFileSync(ENV_FILE, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      // Match KEY=VALUE, skip comments and blanks
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
      if (!m) return;
      // Strip optional surrounding quotes (single or double)
      const val = m[2].replace(/^(['"])(.*)\1$/, "$2").trim();
      envFromFile[m[1]] = val;
    });
} catch (_) {
  // .env not yet written (first-run before env step) — PM2 will still work,
  // but the app will exit immediately due to missing DATABASE_URL.
}

module.exports = {
  apps: [
    {
      name:        "netpulse",
      script:      "./artifacts/api-server/dist/index.mjs",
      cwd:         APP_DIR,
      instances:   1,
      exec_mode:   "fork",
      node_args:   "--enable-source-maps",

      env: {
        NODE_ENV:           "production",
        PORT:               envFromFile.PORT               || "8080",
        DATABASE_URL:       envFromFile.DATABASE_URL       || "",
        BETTER_AUTH_SECRET: envFromFile.BETTER_AUTH_SECRET || "",
        BETTER_AUTH_URL:    envFromFile.BETTER_AUTH_URL    || "http://localhost",
        SESSION_SECRET:     envFromFile.SESSION_SECRET     || "",
         TR069_ACS_ALLOWED_HOSTS: envFromFile.TR069_ACS_ALLOWED_HOSTS || "",
        FRONTEND_DIST_PATH: envFromFile.FRONTEND_DIST_PATH
                            || path.join(APP_DIR, "artifacts/isp-portal/dist/public"),
      },

      max_restarts:    5,
      min_uptime:      "5s",
      restart_delay:   3000,
      out_file:        "/var/log/netpulse/out.log",
      error_file:      "/var/log/netpulse/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
