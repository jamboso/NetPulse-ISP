<?php
/**
 * NetPulse SMS Plugin for NuxBill ISP Billing
 *
 * Plugin Name:    SMS Gateway (Kenya Multi-Provider)
 * Plugin Version: 1.0.0
 * Plugin Author:  NetPulse ISP Manager
 * Description:    Send SMS alerts to customers via 9 Kenyan SMS providers.
 *                 Supports Africa's Talking, MoveSMS, Zettatel, Celcom Africa,
 *                 HostPinnacle, MobileSasa, OnfonMedia, Beem Africa, Advanta Africa.
 *
 * Installation:
 *   1. Copy this folder to /system/plugin/sms/ inside your NuxBill installation.
 *   2. Edit config.php — set SMS_PROVIDER and fill in credentials.
 *   3. Enable the plugin from NuxBill Admin → Settings → SMS Gateway.
 *
 * Requirements:
 *   - PHP 7.4+, cURL enabled
 *   - An account with one of the supported providers (see README.md)
 */

defined('_VALID') or die('Direct access not allowed');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/SmsGateway.php';

// ─── NuxBill Plugin Hooks ─────────────────────────────────────────────────────

/**
 * Register this SMS plugin with NuxBill.
 * NuxBill calls this to discover the plugin's metadata and config fields.
 */
function sms_info(): array
{
    return [
        'name'        => 'SMS Gateway (Kenya Multi-Provider)',
        'description' => 'Send SMS via Africa\'s Talking, MoveSMS, Zettatel, Celcom Africa, HostPinnacle, MobileSasa, OnfonMedia, Beem Africa, or Advanta Africa.',
        'version'     => '1.0.0',
        'author'      => 'NetPulse ISP Manager',
        'config'      => [
            'provider'      => [
                'type'    => 'select',
                'label'   => 'SMS Provider',
                'options' => [
                    'africas_talking' => "Africa's Talking",
                    'movesms'         => 'MoveSMS',
                    'zettatel'        => 'Zettatel',
                    'celcom_africa'   => 'Celcom Africa',
                    'hostpinnacle'    => 'HostPinnacle',
                    'mobilesasa'      => 'MobileSasa',
                    'onfonmedia'      => 'OnfonMedia',
                    'beem_africa'     => 'Beem Africa',
                    'advanta_africa'  => 'Advanta Africa',
                ],
            ],
            'sender_id'     => ['type' => 'text',     'label' => 'Sender ID / Shortcode'],
            'api_key'       => ['type' => 'password', 'label' => 'API Key'],
            'api_secret'    => ['type' => 'password', 'label' => 'API Secret / Password (if required)'],
            'partner_id'    => ['type' => 'text',     'label' => 'Partner ID (if required)'],
            'username'      => ['type' => 'text',     'label' => 'Username (Africa\'s Talking only)'],
            'environment'   => [
                'type'    => 'select',
                'label'   => 'Environment (Africa\'s Talking only)',
                'options' => ['sandbox' => 'Sandbox / Test', 'production' => 'Production'],
            ],
        ],
    ];
}

/**
 * Send an SMS to a customer.
 * NuxBill calls this when it needs to notify a customer.
 *
 * @param  string $to      Recipient phone number (any common Kenyan format)
 * @param  string $message The SMS message body
 * @return array  ['success' => bool, 'message' => string]
 */
function sms_send(string $to, string $message): array
{
    try {
        $gateway = SmsGateway::make();
        return $gateway->send($to, $message);
    } catch (Throwable $e) {
        return [
            'success' => false,
            'message' => 'SMS plugin error: ' . $e->getMessage(),
        ];
    }
}

/**
 * Send a test SMS.
 * Called from NuxBill Admin → Settings → SMS Gateway → Test.
 *
 * @param  string $to Phone number to test with
 * @return array  ['success' => bool, 'message' => string]
 */
function sms_test(string $to): array
{
    return sms_send($to, 'Test message from NetPulse ISP Manager. If you received this, your SMS gateway is working correctly.');
}

// ─── NuxBill Event Triggers ───────────────────────────────────────────────────
// NuxBill calls these hooks automatically when billing events occur.
// Map each event to a formatted SMS then call sms_send().

/**
 * Triggered when a new invoice is generated.
 *
 * @param array $invoice  NuxBill invoice row
 * @param array $customer NuxBill customer row
 */
function sms_on_invoice_created(array $invoice, array $customer): void
{
    $phone   = $customer['phonenumber'] ?? '';
    $name    = $customer['fullname']    ?? 'Customer';
    $amount  = number_format((float)($invoice['total'] ?? 0), 2);
    $dueDate = $invoice['due_date']     ?? 'N/A';
    $invId   = $invoice['id']           ?? '';

    if (empty($phone)) return;

    $msg = "Dear {$name}, Invoice #{$invId} for KES {$amount} has been generated. "
         . "Due date: {$dueDate}. Please pay via M-Pesa or visit our portal. "
         . "Thank you. - NetPulse ISP";

    sms_send($phone, $msg);
}

/**
 * Triggered when a payment is recorded/confirmed.
 *
 * @param array $payment  NuxBill payment row
 * @param array $customer NuxBill customer row
 */
function sms_on_payment_received(array $payment, array $customer): void
{
    $phone  = $customer['phonenumber'] ?? '';
    $name   = $customer['fullname']    ?? 'Customer';
    $amount = number_format((float)($payment['amount'] ?? 0), 2);
    $ref    = $payment['reference']    ?? '';
    $method = ucfirst($payment['method'] ?? 'payment');

    if (empty($phone)) return;

    $msg = "Dear {$name}, we have received KES {$amount} via {$method}"
         . (!empty($ref) ? " (Ref: {$ref})" : '')
         . ". Your account has been credited. Thank you for your payment! - NetPulse ISP";

    sms_send($phone, $msg);
}

/**
 * Triggered when a subscription expires or is about to expire.
 *
 * @param array $subscription NuxBill subscription row
 * @param array $customer     NuxBill customer row
 * @param int   $daysLeft     Days remaining before expiry
 */
function sms_on_subscription_expiring(array $subscription, array $customer, int $daysLeft = 0): void
{
    $phone   = $customer['phonenumber'] ?? '';
    $name    = $customer['fullname']    ?? 'Customer';
    $plan    = $subscription['plan_name'] ?? 'your plan';
    $expDate = $subscription['expiry_date'] ?? 'N/A';

    if (empty($phone)) return;

    if ($daysLeft <= 0) {
        $msg = "Dear {$name}, your {$plan} subscription has expired on {$expDate}. "
             . "Please renew to restore your internet access. Call us or pay via M-Pesa. - NetPulse ISP";
    } else {
        $msg = "Dear {$name}, your {$plan} subscription expires in {$daysLeft} day"
             . ($daysLeft === 1 ? '' : 's')
             . " on {$expDate}. Please renew to avoid interruption. - NetPulse ISP";
    }

    sms_send($phone, $msg);
}

/**
 * Triggered when a support ticket status changes.
 *
 * @param array $ticket   NuxBill ticket row
 * @param array $customer NuxBill customer row
 * @param string $status  New status ('open', 'in_progress', 'resolved', 'closed')
 */
function sms_on_ticket_updated(array $ticket, array $customer, string $status): void
{
    $phone    = $customer['phonenumber'] ?? '';
    $name     = $customer['fullname']    ?? 'Customer';
    $ticketId = $ticket['id']            ?? '';

    if (empty($phone)) return;

    $statusMsg = match ($status) {
        'in_progress' => "is being worked on by our team",
        'resolved'    => "has been resolved. We hope this helps!",
        'closed'      => "has been closed",
        default       => "has been updated (status: {$status})",
    };

    $msg = "Dear {$name}, your support ticket #{$ticketId} {$statusMsg}. "
         . "Login to our portal for details. - NetPulse ISP";

    sms_send($phone, $msg);
}

/**
 * Triggered when a new customer account is created.
 *
 * @param array $customer NuxBill customer row
 * @param string $password Plain-text password (only at account creation)
 */
function sms_on_customer_created(array $customer, string $password = ''): void
{
    $phone = $customer['phonenumber'] ?? '';
    $name  = $customer['fullname']    ?? 'Customer';
    $user  = $customer['username']    ?? '';

    if (empty($phone)) return;

    $msg = "Welcome to NetPulse ISP, {$name}! "
         . "Your account has been created."
         . (!empty($user) ? " Username: {$user}." : '')
         . (!empty($password) ? " Temporary password: {$password}." : '')
         . " Visit our portal to manage your account. - NetPulse ISP";

    sms_send($phone, $msg);
}
