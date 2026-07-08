<?php
/**
 * M-Pesa C2B Confirmation URL
 *
 * Safaricom calls this after a successful Paybill payment.
 * Record the payment and activate the customer's service.
 *
 * URL: https://yourdomain.com/system/plugin/mpesa/c2b_confirmation.php
 */

define('_VALID', 1);
require_once dirname(__DIR__, 3) . '/system/config.php';
require_once dirname(__DIR__, 3) . '/system/autoload.php';
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');

$rawBody = file_get_contents('php://input');
$data    = json_decode($rawBody, true) ?? [];

$mpesaRef   = $data['TransID']        ?? '';
$amount     = (float)($data['TransAmount'] ?? 0);
$phone      = $data['MSISDN']          ?? '';
$billRef    = $data['BillRefNumber']   ?? '';
$firstName  = $data['FirstName']       ?? '';
$paidAt     = date('Y-m-d H:i:s');

// Log the incoming payment
mpesa_c2b_log('c2b_confirmation', compact('mpesaRef', 'amount', 'phone', 'billRef', 'firstName'));

if (empty($mpesaRef) || $amount <= 0) {
    echo json_encode(['ResultCode' => '0', 'ResultDesc' => 'Accepted']);
    exit;
}

$db = nuxbill_db_c2b();

// Look up invoice by bill reference (customers typically enter their username or invoice number)
$invoice = $db->query_one(
    "SELECT i.*, c.id AS cust_id
       FROM tbl_invoices i
       JOIN tbl_customers c ON c.id = i.customer_id
      WHERE i.id = ? OR c.username = ?
      LIMIT 1",
    [(int)$billRef, $billRef]
);

if ($invoice) {
    // Record the payment
    $db->query(
        "INSERT INTO tbl_transactions
            (invoice_id, customer_id, amount, method, reference, status, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, 'mpesa', ?, 'completed', ?, NOW(), NOW())",
        [(int)$invoice['id'], (int)$invoice['cust_id'], $amount, $mpesaRef, $paidAt]
    );

    // Mark invoice as paid
    $db->query(
        "UPDATE tbl_invoices SET status = 'paid', paid_at = ?, updated_at = NOW() WHERE id = ?",
        [$paidAt, (int)$invoice['id']]
    );

    // Activate suspended customer
    $db->query(
        "UPDATE tbl_customers SET status = 'active', updated_at = NOW()
          WHERE id = ? AND status = 'suspended'",
        [(int)$invoice['cust_id']]
    );

    mpesa_c2b_log('c2b_invoice_paid', ['invoice_id' => $invoice['id'], 'mpesaRef' => $mpesaRef]);
} else {
    // No matching invoice — record as unallocated payment for manual review
    $db->query(
        "INSERT INTO tbl_transactions
            (invoice_id, customer_id, amount, method, reference, status, paid_at, notes, created_at, updated_at)
         VALUES (NULL, NULL, ?, 'mpesa', ?, 'completed', ?, ?, NOW(), NOW())",
        [$amount, $mpesaRef, $paidAt, 'Unallocated C2B. Phone: ' . $phone . ', BillRef: ' . $billRef]
    );
    mpesa_c2b_log('c2b_unallocated', compact('mpesaRef', 'amount', 'phone', 'billRef'));
}

echo json_encode(['ResultCode' => '0', 'ResultDesc' => 'Accepted']);
exit;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nuxbill_db_c2b(): object
{
    global $db;
    if (!isset($db)) {
        throw new RuntimeException('NuxBill database not initialised');
    }
    return $db;
}

function mpesa_c2b_log(string $event, $payload): void
{
    $dir = __DIR__ . '/logs';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    $line = date('Y-m-d H:i:s') . ' [' . $event . '] ' . json_encode($payload) . PHP_EOL;
    file_put_contents($dir . '/mpesa_c2b_' . date('Y-m') . '.log', $line, FILE_APPEND | LOCK_EX);
}
