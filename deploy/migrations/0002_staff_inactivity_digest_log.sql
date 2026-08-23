CREATE TABLE IF NOT EXISTS "staff_inactivity_digest_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "company_id" integer NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "digest_date" date NOT NULL,
  "recipient_email" text NOT NULL,
  "affected_count" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "processing_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "error" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_inactivity_digest_company_date_idx"
  ON "staff_inactivity_digest_log" ("company_id", "digest_date");