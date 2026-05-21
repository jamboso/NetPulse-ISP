<?php
/**
 * SMS Plugin Configuration for NuxBill
 *
 * Set ACTIVE_SMS_PROVIDER to one of the driver keys below,
 * then fill in only that provider's credentials.
 *
 * Available drivers:
 *   africas_talking | movesms | zettatel | celcom_africa
 *   hostpinnacle    | mobilesasa | onfonmedia | beem_africa | advanta_africa
 */

defined('_VALID') or die('Direct access not allowed');

// ─── Active Provider ─────────────────────────────────────────────────────────
define('SMS_PROVIDER', 'africas_talking');

// ─── Sender ID / From Name ────────────────────────────────────────────────────
// The name or shortcode that appears on the recipient's phone.
// Must be pre-registered with your provider (alphanumeric, max 11 chars).
define('SMS_SENDER_ID', 'NetPulse');

// ═══════════════════════════════════════════════════════════════════════════
//  1. Africa's Talking  (https://africastalking.com)
// ═══════════════════════════════════════════════════════════════════════════
define('AT_USERNAME',    'sandbox');        // 'sandbox' for testing, your AT username for live
define('AT_API_KEY',     'YOUR_AT_API_KEY');
define('AT_ENVIRONMENT', 'sandbox');        // 'sandbox' | 'production'

// ═══════════════════════════════════════════════════════════════════════════
//  2. MoveSMS  (https://movesms.co.ke)
// ═══════════════════════════════════════════════════════════════════════════
define('MOVESMS_API_KEY',  'YOUR_MOVESMS_API_KEY');
define('MOVESMS_PARTNER_ID', 'YOUR_PARTNER_ID');

// ═══════════════════════════════════════════════════════════════════════════
//  3. Zettatel  (https://portal.zettatel.com)
// ═══════════════════════════════════════════════════════════════════════════
define('ZETTATEL_USER_ID',  'YOUR_ZETTATEL_USER');
define('ZETTATEL_PASSWORD', 'YOUR_ZETTATEL_PASS');
define('ZETTATEL_SENDER_ID', SMS_SENDER_ID);  // or override here

// ═══════════════════════════════════════════════════════════════════════════
//  4. Celcom Africa  (https://celcomafrica.com)
// ═══════════════════════════════════════════════════════════════════════════
define('CELCOM_API_KEY',    'YOUR_CELCOM_API_KEY');
define('CELCOM_PARTNER_ID', 'YOUR_CELCOM_PARTNER_ID');

// ═══════════════════════════════════════════════════════════════════════════
//  5. HostPinnacle  (https://sms.hostpinnacle.co.ke)
// ═══════════════════════════════════════════════════════════════════════════
define('HOSTPINNACLE_API_KEY',    'YOUR_HP_API_KEY');
define('HOSTPINNACLE_PARTNER_ID', 'YOUR_HP_PARTNER_ID');

// ═══════════════════════════════════════════════════════════════════════════
//  6. MobileSasa  (https://mobilesasa.com)
// ═══════════════════════════════════════════════════════════════════════════
define('MOBILESASA_TOKEN', 'YOUR_MOBILESASA_TOKEN');

// ═══════════════════════════════════════════════════════════════════════════
//  7. OnfonMedia  (https://onfonmedia.co.ke)
// ═══════════════════════════════════════════════════════════════════════════
define('ONFON_API_KEY',    'YOUR_ONFON_API_KEY');
define('ONFON_PARTNER_ID', 'YOUR_ONFON_PARTNER_ID');
define('ONFON_CLIENT_ID',  'YOUR_ONFON_CLIENT_ID');

// ═══════════════════════════════════════════════════════════════════════════
//  8. Beem Africa  (https://beem.africa)
// ═══════════════════════════════════════════════════════════════════════════
define('BEEM_API_KEY',    'YOUR_BEEM_API_KEY');
define('BEEM_SECRET_KEY', 'YOUR_BEEM_SECRET_KEY');
define('BEEM_SOURCE_ADDR', SMS_SENDER_ID);

// ═══════════════════════════════════════════════════════════════════════════
//  9. Advanta Africa  (https://quicksms.advantasms.com)
// ═══════════════════════════════════════════════════════════════════════════
define('ADVANTA_API_KEY',    'YOUR_ADVANTA_API_KEY');
define('ADVANTA_PARTNER_ID', 'YOUR_ADVANTA_PARTNER_ID');
