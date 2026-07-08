<?php
/**
 * M-Pesa Callback Handler for NuxBill
 *
 * Safaricom calls this URL after each STK Push completes (success or failure).
 * URL: https://yourdomain.com/system/plugin/mpesa/callback.php
 *
 * IMPORTANT: This file must be publicly accessible over HTTPS.
 *            Do NOT add session_start() or authentication checks here.
 */

// Bootstrap NuxBill without outputting any HTML
define('_VALID', 1);
require_once dirname(__DIR__, 3) . '/system/config.php';
require_once dirname(__DIR__, 3) . '/system/autoload.php';
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');

// Read and decode the raw JSON body Safaricom sends
$rawBody = file_get_contents('php://input');
$data    = json_decode($rawBody, true);

// Log every callback for debugging
mpesa_log('callback_received', $rawBody);

// Acknowledge immediately — Safaricom expects a 200 response quickly
$ack = json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);

$callback = $data['Body']['stkCallback'] ?? null;

if (!$callback) {
    echo $ack;
    exit;
}

$resultCode = (int)($callback['ResultCode'] ?? -1);
$merchantId = $callback['MerchantRequestID'] ?? '';
$checkoutId = $callback['CheckoutRequestID'] ?? '';

if ($resultCode !== 0) {
    // Payment failed or customer cancelled
    mpesa_log('payment_failed', [
        'ResultCode' => $resultCode,
        'ResultDesc' => $callback['ResultDesc'] ?? '',
        'CheckoutRequestID' => $checkoutId,
    ]);

    // Update any pending transaction to 'failed'
    $db = nuxbill_db();
    $db->query(
        "UPDATE tbl_transactions SET status = 'failed', updated_at = NOW() WHERE reference = ?",
        [$checkoutId]
    );

    echo $ack;
    exit;
}

// Payment succeeded — extract metadata
$items     = $callback['CallbackMetadata']['Item'] ?? [];
$meta      = [];
foreach ($items as $item) {
    $meta[$item['Name']] = $item['Value'] ?? null;
}

$mpesaRef = (string)($meta['MpesaReceiptNumber'] ?? '');
$amount   = (float)($meta['Amount'] ?? 0);
$phone    = (string)($meta['PhoneNumber'] ?? '');
$paidAt   = isset($meta['TransactionDate'])
    ? DateTime::createFromFormat('YmdHis', (string)$meta['TransactionDate'])->format('Y-m-d H:i:s')
    : date('Y-m-d H:i:s');

mpesa_log('payment_success', compact('mpesaRef', 'amount', 'phone', 'paidAt'));

$db = nuxbill_db();

// Mark the pending transaction as completed
$db->query(
    "UPDATE tbl_transactions
        SET status = 'completed', reference = ?, paid_at = ?, updated_at = NOW()
      WHERE reference = ? AND status = 'pending'",
    [$mpesaRef, $paidAt, $checkoutId]
);

// Find the transaction to get the invoice/customer IDs
$txn = $db->query_one(
    "SELECT * FROM tbl_transactions WHERE reference = ? LIMIT 1",
    [$mpesaRef]
);

if ($txn) {
    // Mark the NuxBill invoice as paid
    $db->query(
        "UPDATE tbl_invoices SET status = 'paid', paid_at = ?, updated_at = NOW() WHERE id = ?",
        [$paidAt, (int)$txn['invoice_id']]
    );

    // Activate the customer's service if it was suspended
    $db->query(
        "UPDATE tbl_customers SET status = 'active', updated_at = NOW()
          WHERE id = ? AND status = 'suspended'",
        [(int)$txn['customer_id']]
    );

    mpesa_log('invoice_paid', ['invoice_id' => $txn['invoice_id'], 'customer_id' => $txn['customer_id']]);
} else {
    // Unknown payment — record it for manual review
    $db->query(
        "INSERT INTO tbl_transactions
            (invoice_id, customer_id, amount, method, reference, status, paid_at, created_at, updated_at)
         VALUES (NULL, NULL, ?, 'mpesa', ?, 'completed', ?, NOW(), NOW())",
        [$amount, $mpesaRef, $paidAt]
    );
    mpesa_log('unknown_payment', compact('mpesaRef', 'amount', 'phone'));
}

echo $ack;
exit;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nuxbill_db(): object
{
    global $db;
    if (!isset($db)) {
        throw new RuntimeException('NuxBill database not initialised');
    }
    return $db;
}

function mpesa_log(string $event, $payload): void
{
    $dir  = __DIR__ . '/logs';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    $line = date('Y-m-d H:i:s') . ' [' . $event . '] ' . (is_string($payload) ? $payload : json_encode($payload)) . PHP_EOL;
    file_put_contents($dir . '/mpesa_' . date('Y-m') . '.log', $line, FILE_APPEND | LOCK_EX);
}
