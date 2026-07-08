# NetPulse ISP Manager — Installation Guide

> **Status**: Save for when the app is feature-complete before public release.
> Update `YOUR/REPO` placeholders with the real GitHub URL before publishing.

---

## Quick Install (Ubuntu 22.04 / 24.04)

One command. That's it:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR/REPO/main/deploy/install.sh | sudo bash
```

The script runs for ~5–8 minutes then prints your server URL. Open it in a browser and follow the Setup Wizard.

---

## What the script does (9 steps)

| Step | What happens |
|------|-------------|
| **[1/9] Pre-flight** | Checks OS (Ubuntu 20.04+), RAM ≥ 1 GB, disk ≥ 5 GB, internet |
| **[2/9] System packages** | `git nginx postgresql openssl ufw curl` |
| **[3/9] Node.js 24** | Via NodeSource apt repo; skips if already installed |
| **[4/9] PostgreSQL** | Creates `netpulse` database + user, auto-generates password |
| **[5/9] Code** | Clones repo to `/opt/netpulse`; detects existing install and runs upgrade mode |
| **[6/9] .env** | Writes production config with auto-generated `SESSION_SECRET` and `DATABASE_URL`; Clerk keys are placeholders (set after install) |
| **[7/9] Build** | `pnpm install` → libs → API → frontend |
| **[8/9] PM2** | Starts app as `netpulse` process, enables systemd auto-start |
| **[9/9] nginx + UFW** | Reverse proxy on port 80; opens 22, 80, 443, 1194, 1812, 1813 |

Ends with a health check (`curl /api/healthz`) and a summary box with the URL + next steps.

---

## After install — First Run Wizard

1. Open `http://YOUR_SERVER_IP` in your browser
2. Sign in (you'll be directed to set up Clerk first — see below)
3. The **Setup Wizard** launches automatically
4. Fill in: Company info → Timezone & currency → Billing defaults
5. Click **Launch NetPulse** → you're on the dashboard

The wizard never shows again after completion.

---

## Setting up Clerk (required for login)

Clerk handles user authentication. After install:

1. Go to **https://dashboard.clerk.com**
2. Create a **Production** application
3. Under **Domains**, add your server's domain or IP
4. Copy the **Publishable Key** and **Secret Key**
5. Edit `/opt/netpulse/.env`:
   ```
   CLERK_PUBLISHABLE_KEY=pk_live_xxxxx
   CLERK_SECRET_KEY=sk_live_xxxxx
   VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxxxx
   ```
6. Rebuild and restart:
   ```bash
   sudo bash /opt/netpulse/deploy/update.sh
   ```

---

## HTTPS with Let's Encrypt (recommended)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Certbot auto-renews every 90 days.

---

## Updating to a new version

```bash
sudo bash /opt/netpulse/deploy/update.sh
```

This pulls latest code, rebuilds everything, runs DB migrations, and restarts.

---

## Useful commands

```bash
pm2 status                        # Check app process
pm2 logs netpulse                 # Live logs
pm2 restart netpulse              # Restart app
pm2 stop netpulse                 # Stop app

cat /var/log/netpulse/install.log # Full install log
cat /var/log/netpulse/update.log  # Full update log
tail -f /var/log/nginx/netpulse-error.log  # nginx errors

sudo -u postgres psql netpulse    # Connect to database
```

---

## File locations

| Path | What's there |
|------|-------------|
| `/opt/netpulse/` | Application code |
| `/opt/netpulse/.env` | Environment config (Clerk keys, DB URL) |
| `/etc/nginx/sites-available/netpulse` | nginx config |
| `/var/log/netpulse/` | Install + update logs |
| `/var/log/nginx/netpulse-*.log` | Web server logs |

---

## Minimum server requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 10 GB | 20 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Ports | 22, 80, 443 | + 1194 (VPN), 1812-1813 (RADIUS) |

---

## Troubleshooting

**App not responding after install**
```bash
pm2 logs netpulse     # look for startup errors
pm2 restart netpulse
```

**Database connection error**
```bash
sudo systemctl status postgresql
cat /opt/netpulse/.env | grep DATABASE_URL
```

**nginx 502 Bad Gateway**
```bash
pm2 status            # is netpulse running?
curl localhost:8080/api/healthz   # test API directly
```

**Login page blank / Clerk error**
- Check `CLERK_PUBLISHABLE_KEY` in `.env` — must be `pk_live_` (not `pk_test_`)
- Ensure your domain is added in Clerk dashboard → Domains
- Run `update.sh` after changing keys (frontend must be rebuilt)

---

*Last updated: when app is feature-complete — update version numbers and repo URL before publishing.*
