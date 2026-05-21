# NetPulse SMS Plugin for NuxBill

A drop-in SMS plugin for **NuxBill ISP Billing** that supports **9 Kenyan SMS providers** through a single unified interface.

---

## Supported Providers

| Key | Provider | Website |
|-----|----------|---------|
| `africas_talking` | **Africa's Talking** | https://africastalking.com |
| `movesms` | **MoveSMS** | https://movesms.co.ke |
| `zettatel` | **Zettatel** | https://portal.zettatel.com |
| `celcom_africa` | **Celcom Africa** | https://celcomafrica.com |
| `hostpinnacle` | **HostPinnacle** | https://sms.hostpinnacle.co.ke |
| `mobilesasa` | **MobileSasa** | https://mobilesasa.com |
| `onfonmedia` | **OnfonMedia (Onfon)** | https://onfonmedia.co.ke |
| `beem_africa` | **Beem Africa** | https://beem.africa |
| `advanta_africa` | **Advanta Africa** | https://quicksms.advantasms.com |

---

## Installation

1. Copy the entire `sms/` folder to your NuxBill plugin directory:
   ```
   /system/plugin/sms/
   ```

2. Open `config.php` and:
   - Set `SMS_PROVIDER` to your chosen provider key (e.g. `'africas_talking'`)
   - Set `SMS_SENDER_ID` to your registered sender ID / shortcode
   - Fill in your provider's credentials (only the relevant section)

3. Enable the plugin in NuxBill Admin → **Settings → SMS Gateway**

4. Send a test SMS from Admin → **Settings → SMS Gateway → Test**

---

## Provider Setup Guides

### 1. Africa's Talking
1. Sign up at https://africastalking.com
2. Create an app and get your **API Key** and **Username**
3. For testing: Username = `sandbox`, Environment = `sandbox`
4. Register your Sender ID (takes 1–3 business days)
5. In `config.php`: set `AT_API_KEY`, `AT_USERNAME`, `AT_ENVIRONMENT`

### 2. MoveSMS
1. Sign up at https://movesms.co.ke
2. Get your **API Key** and **Partner ID** from the dashboard
3. Register your Sender ID
4. In `config.php`: set `MOVESMS_API_KEY`, `MOVESMS_PARTNER_ID`

### 3. Zettatel
1. Sign up at https://portal.zettatel.com
2. Get your **User ID** and **Password** from Account Settings
3. Register a Sender ID under Settings → Sender IDs
4. In `config.php`: set `ZETTATEL_USER_ID`, `ZETTATEL_PASSWORD`

### 4. Celcom Africa
1. Sign up at https://celcomafrica.com
2. Obtain your **API Key** and **Partner ID**
3. Register your Sender ID
4. In `config.php`: set `CELCOM_API_KEY`, `CELCOM_PARTNER_ID`

### 5. HostPinnacle
1. Sign up at https://sms.hostpinnacle.co.ke
2. Get your **API Key** and **Partner ID** from the dashboard
3. Register your Sender ID / shortcode
4. In `config.php`: set `HOSTPINNACLE_API_KEY`, `HOSTPINNACLE_PARTNER_ID`

### 6. MobileSasa
1. Sign up at https://mobilesasa.com
2. Generate an **API Token** from Settings → API
3. Register your Sender ID
4. In `config.php`: set `MOBILESASA_TOKEN`

### 7. OnfonMedia
1. Sign up at https://onfonmedia.co.ke
2. Obtain your **API Key**, **Partner ID**, and **Client ID**
3. Register your Sender ID
4. In `config.php`: set `ONFON_API_KEY`, `ONFON_PARTNER_ID`, `ONFON_CLIENT_ID`

### 8. Beem Africa
1. Sign up at https://beem.africa
2. Get your **API Key** and **Secret Key** from the dashboard
3. Register your Source Address (Sender ID) — must be approved
4. In `config.php`: set `BEEM_API_KEY`, `BEEM_SECRET_KEY`

### 9. Advanta Africa
1. Sign up at https://quicksms.advantasms.com
2. Get your **API Key** and **Partner ID**
3. Register your Sender ID
4. In `config.php`: set `ADVANTA_API_KEY`, `ADVANTA_PARTNER_ID`

---

## Automatic SMS Events

The plugin fires SMS notifications on these NuxBill events automatically:

| Event | Trigger Function | Description |
|-------|-----------------|-------------|
| Invoice created | `sms_on_invoice_created()` | Notify customer of new invoice + due date |
| Payment received | `sms_on_payment_received()` | Confirm payment with amount + reference |
| Subscription expiring | `sms_on_subscription_expiring()` | Warn N days before expiry |
| Subscription expired | `sms_on_subscription_expiring(..., 0)` | Notify on actual expiry |
| Ticket updated | `sms_on_ticket_updated()` | Notify on ticket status changes |
| Account created | `sms_on_customer_created()` | Welcome SMS with credentials |

---

## Phone Number Formats Accepted

The plugin auto-normalises Kenyan numbers to international format (`2547XXXXXXXX`):

| Input format | Normalised to |
|-------------|---------------|
| `0712345678` | `254712345678` |
| `712345678` | `254712345678` |
| `+254712345678` | `254712345678` |
| `254712345678` | `254712345678` |
| `0110000000` (Airtel/Telkom) | `254110000000` |

---

## File Structure

```
sms/
├── sms.php           ← Main NuxBill plugin entry point
├── config.php        ← All provider credentials (edit this)
├── SmsGateway.php    ← Abstract base class + driver factory
├── drivers/
│   ├── AfricasTalking.php
│   ├── MoveSms.php
│   ├── Zettatel.php
│   ├── CelcomAfrica.php
│   ├── HostPinnacle.php
│   ├── MobileSasa.php
│   ├── OnfonMedia.php
│   ├── BeemAfrica.php
│   └── AdvantaAfrica.php
└── README.md
```

---

## Adding a New Provider

1. Create `drivers/YourProvider.php` extending `SmsGateway`
2. Implement the `send(string $to, string $message): array` method
3. Add the key → class mapping in `SmsGateway::make()`
4. Add credentials to `config.php`
5. Add the option to `sms_info()` in `sms.php`

---

## Requirements

- PHP 7.4 or later
- cURL extension enabled (`php-curl`)
- NuxBill 3.x or later
- Active account with your chosen SMS provider
