---
name: Oslo password hash format
description: How better-auth/oslo stores scrypt password hashes in the accounts table
---

# Oslo Scrypt Hash Format

oslo's `Scrypt` class (used by better-auth) stores passwords in the `accounts` table as:

```
<16-byte-salt-as-lowercase-hex>:<64-byte-hash-as-lowercase-hex>
```

Example: `a48daa3c32e89bd30b7e6d1b1b0ef3a1:70ca65ac4fded025...`

**NOT** the `$scrypt$N=16384,...` MCF format.

Parameters: N=16384, r=16, p=1, dklen=64

## Manual reset command (Ubuntu server)

```bash
python3 -c "
import hashlib, os, subprocess
password = b'NewPassword'
salt = os.urandom(16)
h = hashlib.scrypt(password, salt=salt, n=16384, r=16, p=1, dklen=64, maxmem=67108864)
pw_hash = salt.hex() + ':' + h.hex()
sql = \"UPDATE accounts SET password='\" + pw_hash + \"' WHERE user_id IN (SELECT id FROM users WHERE email='user@example.com') AND provider_id='credential';\"
r = subprocess.run(['sudo','-u','postgres','psql','-d','netpulse','-c',sql], capture_output=True, text=True)
print(r.stdout or r.stderr)
"
```

**Why:** Ubuntu 24.04 OpenSSL limits scrypt memory without `maxmem`. Always pass `maxmem=67108864` (64MB).

**How to apply:** Use this whenever you need to manually reset a user's password on the Ubuntu server.

## Column names on production server

The production PostgreSQL schema uses snake_case column names:
- `provider_id` (not `providerId`)
- `user_id` (not `userId`)
- `account_id` (not `accountId`)
