<?php
/**
 * NetPulse M-Pesa Payment Plugin for NuxBill ISP Billing
 *
 * Plugin Name:    M-Pesa (Safaricom Daraja)
 * Plugin Version: 2.0.0
 * Plugin Author:  NetPulse ISP Manager
 * Description:    Lipa Na M-Pesa STK Push + C2B integration for NuxBill.
 *
 * Installation:
 *   1. Copy this folder to /system/plugin/mpesa/ inside your NuxBill installation.
 *   2. Edit config.php with your Daraja API credentials.
 *   3. Enable the plugin from NuxBill Admin → Settings → Payment Gateway.
 *   4. Set your Callback URL in Daraja portal to:
 *        https://yourdomain.com/system/plugin/mpesa/callback.php
 *
 * Requirements:
 *   - PHP 7.4+, cURL enabled
 *   - Safaricom Daraja API account (https://developer.safaricom.co.ke)
 *   - NuxBill 3.x or later
 */

defined('_VALID') or die('Direct access not allowed');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/MpesaAPI.php';

/** ---------------------------------------------------------------
 *  NuxBill hooks
 * --------------------------------------------------------------- */

/**
 * Register this gateway with NuxBill.
 * NuxBill calls this to discover available payment methods.
 */
function mpesa_info(): array
{
    return [
        'name'        => 'M-Pesa',
        'description' => 'Pay via Safaricom M-Pesa STK Push (Lipa Na M-Pesa)',
        'version'     => '2.0.0',
        'author'      => 'NetPulse ISP Manager',
        'config'      => [
            'consumer_key'    => ['type' => 'text',     'label' => 'Consumer Key'],
            'consumer_secret' => ['type' => 'password', 'label' => 'Consumer Secret'],
            'shortcode'       => ['type' => 'text',     'label' => 'Business Short Code'],
            'passkey'         => ['type' => 'password', 'label' => 'Lipa Na M-Pesa Passkey'],
            'environment'     => ['type' => 'select',   'label' => 'Environment',
                                  'options' => ['sandbox' => 'Sandbox', 'production' => 'Production']],
            'callback_url'    => ['type' => 'text',     'label' => 'Callback URL'],
        ],
    ];
}

/**
 * Render the payment form shown to the customer.
 * NuxBill passes the invoice details here.
 *
 * @param array $invoice  NuxBill invoice row
 * @param array $customer NuxBill customer row
 */
function mpesa_payment_form(array $invoice, array $customer): string
{
    $amount    = number_format((float)$invoice['total'], 2);
    $invoiceId = (int)$invoice['id'];
    $phone     = htmlspecialchars($customer['phonenumber'] ?? '', ENT_QUOTES);

    return <<<HTML
<div class="panel panel-default">
  <div class="panel-heading"><strong>Pay with M-Pesa</strong></div>
  <div class="panel-body">
    <p>You will receive an M-Pesa prompt on your phone. Enter your PIN to complete the payment.</p>
    <form id="mpesa-form" method="POST" action="?_route=plugin/mpesa/initiate">
      <input type="hidden" name="invoice_id" value="{$invoiceId}">
      <div class="form-group">
        <label>M-Pesa Phone Number</label>
        <input type="tel" name="phone" class="form-control"
               placeholder="07XXXXXXXX or 2547XXXXXXXX"
               value="{$phone}" required>
        <small class="text-muted">Registered Safaricom number</small>
      </div>
      <div class="form-group">
        <label>Amount (KES)</label>
        <input type="text" class="form-control" value="{$amount}" readonly>
      </div>
      <button type="submit" class="btn btn-success btn-block">
        <i class="fa fa-mobile"></i> Send M-Pesa Prompt
      </button>
    </form>
    <div id="mpesa-status" class="alert" style="display:none; margin-top:12px;"></div>
  </div>
</div>
HTML;
}

/**
 * Initiate STK Push when the customer submits the payment form.
 * NuxBill routes POST ?_route=plugin/mpesa/initiate here.
 *
 * @param array $post     Sanitised $_POST data
 * @param array $invoice  NuxBill invoice row
 * @param array $customer NuxBill customer row
 */
function mpesa_initiate(array $post, array $invoice, array $customer): array
{
    $phone     = preg_replace('/\D/', '', $post['phone'] ?? '');
    $amount    = (float)$invoice['total'];
    $invoiceId = (int)$invoice['id'];
    $ref       = 'INV-' . $invoiceId;

    if (empty($phone)) {
        return ['success' => false, 'message' => 'Phone number is required.'];
    }

    // Normalise to 254XXXXXXXXX
    if (strlen($phone) === 10 && str_starts_with($phone, '0')) {
        $phone = '254' . substr($phone, 1);
    } elseif (strlen($phone) === 9) {
        $phone = '254' . $phone;
    }

    if (!preg_match('/^2547\d{8}$/', $phone)) {
        return ['success' => false, 'message' => 'Enter a valid Safaricom number (07XXXXXXXX).'];
    }

    $api    = new MpesaAPI(MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_ENVIRONMENT);
    $result = $api->stkPush(
        MPESA_SHORTCODE,
        MPESA_PASSKEY,
        (int)ceil($amount),
        $phone,
        MPESA_CALLBACK_URL,
        $ref,
        'NetPulse ISP Invoice ' . $ref
    );

    if (!empty($result['ResponseCode']) && $result['ResponseCode'] === '0') {
        // Store pending payment in NuxBill's DB for later verification
        $db = nuxbill_db();
        $db->query(
            "INSERT INTO tbl_transactions
                (invoice_id, customer_id, amount, method, reference, status, created_at)
             VALUES (?, ?, ?, 'mpesa', ?, 'pending', NOW())",
            [$invoiceId, (int)$customer['id'], $amount, $result['CheckoutRequestID']]
        );

        return [
            'success'            => true,
            'message'            => 'M-Pesa prompt sent! Check your phone and enter your PIN.',
            'checkout_request_id' => $result['CheckoutRequestID'],
        ];
    }

    $errMsg = $result['errorMessage'] ?? ($result['ResultDesc'] ?? 'STK Push failed. Try again.');
    return ['success' => false, 'message' => $errMsg];
}

/**
 * Called by NuxBill when it wants to check payment status for an invoice.
 * You can optionally implement STK Push query here.
 *
 * @param array $invoice NuxBill invoice row
 */
function mpesa_check_payment(array $invoice): array
{
    $db  = nuxbill_db();
    $row = $db->query_one(
        "SELECT * FROM tbl_transactions
          WHERE invoice_id = ? AND method = 'mpesa' AND status = 'completed'
          ORDER BY created_at DESC LIMIT 1",
        [(int)$invoice['id']]
    );

    if ($row) {
        return ['paid' => true, 'reference' => $row['reference']];
    }

    return ['paid' => false];
}
