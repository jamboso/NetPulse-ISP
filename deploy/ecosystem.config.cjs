/**
 * PM2 ecosystem config — production process manager for NetPulse API server.
 * Usage:
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */

require("dotenv").config({ path: "/opt/netpulse/.env" });

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
        NODE_ENV:             "production",
        PORT:                 process.env.PORT             || "8080",
        DATABASE_URL:         process.env.DATABASE_URL,
        CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
        CLERK_SECRET_KEY:     process.env.CLERK_SECRET_KEY,
        SESSION_SECRET:       process.env.SESSION_SECRET,
        FRONTEND_DIST_PATH:   process.env.FRONTEND_DIST_PATH
                              || "/opt/netpulse/artifacts/isp-portal/dist/public",
      },
      // Restart if it crashes, up to 5 times in 5 minutes
      max_restarts: 5,
      min_uptime:   "5s",
      restart_delay: 3000,
      // Logs
      out_file:  "/var/log/netpulse/out.log",
      error_file: "/var/log/netpulse/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
