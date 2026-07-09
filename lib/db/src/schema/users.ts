import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

// Schema aligned with better-auth v1.x drizzle adapter requirements.
// Custom fields (role, active) exposed via better-auth additionalFields.

export const usersTable = pgTable("users", {
  id:            text("id").primaryKey(),
  email:         text("email").notNull().unique(),
  name:          text("name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image:         text("image"),
  role:          text("role").notNull().default("admin"),
  active:        boolean("active").notNull().default(true),
  phone:         text("phone"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});

export const sessionsTable = pgTable("sessions", {
  id:          text("id").primaryKey(),
  userId:      text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  expiresAt:   timestamp("expires_at").notNull(),
  token:       text("token").notNull().unique(),
  ipAddress:   text("ip_address"),
  userAgent:   text("user_agent"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

// better-auth stores email/password credentials here (provider = "credential")
export const accountsTable = pgTable("accounts", {
  id:           text("id").primaryKey(),
  userId:       text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  accountId:    text("account_id").notNull(),
  providerId:   text("provider_id").notNull(),
  accessToken:  text("access_token"),
  refreshToken: text("refresh_token"),
  idToken:      text("id_token"),
  expiresAt:    timestamp("expires_at"),
  password:     text("password"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
  updatedAt:    timestamp("updated_at").defaultNow().notNull(),
});

export const verificationsTable = pgTable("verifications", {
  id:         text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value:      text("value").notNull(),
  expiresAt:  timestamp("expires_at").notNull(),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  updatedAt:  timestamp("updated_at").defaultNow().notNull(),
});
