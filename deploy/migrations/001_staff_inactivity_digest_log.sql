CREATE TABLE IF NOT EXISTS staff_inactivity_digest_log (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  digest_date DATE NOT NULL,
  recipient_email TEXT NOT NULL,
  affected_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_inactivity_digest_company_date_idx
  ON staff_inactivity_digest_log (company_id, digest_date);