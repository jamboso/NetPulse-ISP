<?php
/**
 * M-Pesa Plugin Configuration for NuxBill
 *
 * Edit these values with your Safaricom Daraja API credentials.
 * Get credentials at: https://developer.safaricom.co.ke
 */

defined('_VALID') or die('Direct access not allowed');

// ─── Environment ────────────────────────────────────────────────────────────
// 'sandbox'    → Use Safaricom sandbox (for testing, no real money moved)
// 'production' → Live Safaricom API (real payments)
define('MPESA_ENVIRONMENT', 'sandbox');

// ─── Daraja API Credentials ─────────────────────────────────────────────────
// From https://developer.safaricom.co.ke → My Apps → Your App
define('MPESA_CONSUMER_KEY',    'YOUR_CONSUMER_KEY_HERE');
define('MPESA_CONSUMER_SECRET', 'YOUR_CONSUMER_SECRET_HERE');

// ─── Business Details ────────────────────────────────────────────────────────
// PayBill or Till number assigned by Safaricom
define('MPESA_SHORTCODE', '174379');   // 174379 = Safaricom sandbox shortcode

// Lipa Na M-Pesa Online Passkey (from Daraja portal → LNM Passkey)
define('MPESA_PASSKEY', 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919');

// ─── Callback URLs ───────────────────────────────────────────────────────────
// Must be a publicly reachable HTTPS URL (not localhost).
// Safaricom will POST payment results to this URL.
define('MPESA_CALLBACK_URL',     'https://yourdomain.com/system/plugin/mpesa/callback.php');

// C2B Paybill URLs (needed only if using C2B/Paybill flow)
define('MPESA_C2B_VALIDATION',   'https://yourdomain.com/system/plugin/mpesa/c2b_validation.php');
define('MPESA_C2B_CONFIRMATION', 'https://yourdomain.com/system/plugin/mpesa/c2b_confirmation.php');

// ─── Optional ────────────────────────────────────────────────────────────────
// Custom name shown on the customer's M-Pesa prompt
define('MPESA_ACCOUNT_NAME', 'NetPulse ISP');
