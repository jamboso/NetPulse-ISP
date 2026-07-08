import { defineConfig } from "drizzle-kit";
import path from "path";
import { config } from "dotenv";

// Load .env from repo root (two levels up: lib/db → lib → root)
config({ path: path.join(__dirname, "../../.env") });
// Also try the project deploy root (/opt/netpulse/.env on server)
if (!process.env.DATABASE_URL) {
  config({ path: "/opt/netpulse/.env" });
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
