#!/usr/bin/env node
/**
 * Reset a user's password directly in the database.
 * Usage: node scripts/reset-password.mjs <email> <new-password>
 *
 * Run from the repo root on the server where DATABASE_URL is set.
 */
import { Scrypt } from "oslo/password";
import pg from "pg";

const [,, email, newPassword] = process.argv;

if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-password.mjs <email> <new-password>");
  process.exit(1);
}

if (newPassword.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

const scrypt = new Scrypt();
const hash = await scrypt.hash(newPassword);

const userRes = await client.query(
  `SELECT id FROM users WHERE email = $1`,
  [email]
);

if (userRes.rows.length === 0) {
  console.error(`No user found with email: ${email}`);
  await client.end();
  process.exit(1);
}

const userId = userRes.rows[0].id;

const updateRes = await client.query(
  `UPDATE accounts SET password = $1 WHERE "userId" = $2 AND "providerId" = 'credential'`,
  [hash, userId]
);

if (updateRes.rowCount === 0) {
  console.error("No credential account found for this user. Creating one...");
  const accountId = email;
  await client.query(
    `INSERT INTO accounts ("userId", "accountId", "providerId", password, "createdAt", "updatedAt")
     VALUES ($1, $2, 'credential', $3, NOW(), NOW())`,
    [userId, accountId, hash]
  );
  console.log("Credential account created with new password.");
} else {
  console.log(`Password updated for ${email}`);
}

await client.end();
