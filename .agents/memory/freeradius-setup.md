---
name: FreeRADIUS setup on Ubuntu 24.04
description: Steps required to get FreeRADIUS working with the netpulse PostgreSQL database
---

# FreeRADIUS + PostgreSQL Setup

## Problems solved (in order)

1. **SSL cert error** (`could not open certificate file "/root/.postgresql/postgresql.crt"`)
   - Fix: `sudo systemctl edit freeradius` → add `[Service]\nEnvironment="PGSSLMODE=disable"`
   - Then `sudo systemctl daemon-reload && sudo systemctl restart freeradius`

2. **Password auth failed** (`FATAL: password authentication failed for user "netpulse"`)
   - Cause: PG user stored SCRAM-SHA-256 hash, but libpq in FreeRADIUS package is too old for SCRAM
   - Fix: Change to MD5: `sudo -u postgres psql -c "SET password_encryption = 'md5'; ALTER USER netpulse WITH PASSWORD '...';"`
   - Add pg_hba.conf rule BEFORE the scram-sha-256 default: `sudo sed -i '/^host.*127.0.0.1\/32.*scram-sha-256/i host    netpulse        netpulse        127.0.0.1\/32            md5' /etc/postgresql/*/main/pg_hba.conf`
   - Then `sudo systemctl reload postgresql`

3. **`nas` table missing** (`relation "nas" does not exist`)
   - Fix: Import FreeRADIUS schema: `sudo cp /etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql /tmp/fr-schema.sql && sudo chmod 644 /tmp/fr-schema.sql && sudo -u postgres psql -d netpulse -f /tmp/fr-schema.sql`
   - Note: The schema dir is permission-restricted; copy it first.

4. **Permission denied on nas table**
   - Fix: `sudo -u postgres psql -d netpulse -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO netpulse; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO netpulse;"`

**Why:** FreeRADIUS runs as `freerad` user; all PostgreSQL objects created by `postgres` are not accessible to `netpulse` by default.

## Verification

```bash
sudo systemctl status freeradius
# Should show: Active: active (running), Status: "Processing requests"
```
