# M-Pesa Plugin for NuxBill ISP Billing

Integrates Safaricom M-Pesa (Lipa Na M-Pesa STK Push + C2B Paybill) with NuxBill ISP billing software.

## Files

| File | Purpose |
|------|---------|
| `mpesa.php` | Main NuxBill plugin — registers the gateway, renders the payment form |
| `MpesaAPI.php` | Safaricom Daraja API client (token fetch, STK Push, C2B registration) |
| `callback.php` | STK Push result callback — Safaricom POSTs here after payment |
| `c2b_validation.php` | C2B validation URL (accepts or rejects Paybill payments) |
| `c2b_confirmation.php` | C2B confirmation URL — records completed Paybill payments |
| `config.php` | **Edit this file** with your Daraja credentials |
| `logs/` | Auto-created — monthly log files for debugging |

## Quick Setup

### 1. Copy to NuxBill
```
/path/to/nuxbill/system/plugin/mpesa/
```

### 2. Edit `config.php`
```php
define('MPESA_ENVIRONMENT',    'production');       // or 'sandbox' for testing
define('MPESA_CONSUMER_KEY',    'abc123...');
define('MPESA_CONSUMER_SECRET', 'xyz789...');
define('MPESA_SHORTCODE',       '123456');          // Your PayBill number
define('MPESA_PASSKEY',         'your-passkey');    // From Daraja portal
define('MPESA_CALLBACK_URL',    'https://yourdomain.com/system/plugin/mpesa/callback.php');
```

### 3. Register C2B URLs (once, run via Tinker or a one-off script)
```php
require 'MpesaAPI.php';
$api = new MpesaAPI(MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_ENVIRONMENT);
$api->registerC2BUrls(
    MPESA_SHORTCODE,
    MPESA_C2B_VALIDATION,
    MPESA_C2B_CONFIRMATION
);
```

### 4. Enable in NuxBill
Admin → Settings → Payment Gateway → Enable **M-Pesa**

## Payment Flow

### STK Push (recommended)
1. Customer clicks **Pay with M-Pesa** on the invoice page
2. Enters their Safaricom number
3. Receives a push notification — enters PIN
4. Safaricom POSTs result to `callback.php`
5. Invoice is marked paid, customer service is reactivated

### C2B Paybill (alternative)
1. Customer dials `*234#` → Pay Bill → Business No. → Your shortcode
2. Enters invoice ID or username as account number
3. Safaricom calls `c2b_confirmation.php`
4. Invoice matched and marked paid automatically

## Sandbox Testing

Use the [Safaricom Daraja sandbox](https://developer.safaricom.co.ke/docs):
- Shortcode: `174379`
- Passkey: `bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919`
- Test phone: `254708374149`

> Sandbox STK Push does **not** deliver a real phone prompt — check the callback URL response instead.

## Logs

Monthly log files are written to `logs/`:
- `mpesa_YYYY-MM.log` — STK Push callbacks
- `mpesa_c2b_YYYY-MM.log` — C2B payments

Protect the `logs/` directory with `.htaccess`:
```apache
Deny from all
```
