/**
 * PM2 ecosystem config — production process manager for NetPulse API server.
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 *
 * Note: dotenv is NOT available in PM2's global context, so we parse the
 * .env file inline using Node.js built-ins.
 */

const fs = require("fs");
const ENV_FILE = "/opt/netpulse/.env";
try {
  fs.readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .forEach((line) => {
      const m = line.match(/^\s*([^#\s=][^=]*?)\s*=\s*(.*?)\s*$/);
      if (m) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
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
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV:           "production",
        PORT:               process.env.PORT               || "8080",
        DATABASE_URL:       process.env.DATABASE_URL,
        SESSION_SECRET:     process.env.SESSION_SECRET,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL:    process.env.BETTER_AUTH_URL,
        FRONTEND_DIST_PATH: process.env.FRONTEND_DIST_PATH
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
