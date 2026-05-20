<?php
/**
 * M-Pesa C2B Validation URL
 *
 * Safaricom calls this before processing a Paybill payment.
 * Return ResultCode 0 to accept or 1 to reject.
 *
 * URL: https://yourdomain.com/system/plugin/mpesa/c2b_validation.php
 */

define('_VALID', 1);
require_once dirname(__DIR__, 3) . '/system/config.php';
require_once dirname(__DIR__, 3) . '/system/autoload.php';
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');

$rawBody = file_get_contents('php://input');
$data    = json_decode($rawBody, true) ?? [];

$phone      = $data['MSISDN']       ?? '';
$billRef    = $data['BillRefNumber'] ?? '';
$amount     = (float)($data['TransAmount'] ?? 0);

// Optional: validate that the bill reference matches an existing invoice
// $invoice = find_invoice_by_ref($billRef);
// if (!$invoice) {
//     echo json_encode(['ResultCode' => 'C2B00012', 'ResultDesc' => 'Rejected: invalid account']);
//     exit;
// }

echo json_encode(['ResultCode' => '0', 'ResultDesc' => 'Accepted']);
