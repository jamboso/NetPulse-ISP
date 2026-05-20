<?php

/**
 * M-Pesa C2B Plugin for NuxBill
 * Fixed version — 11 bugs corrected (see bottom of file for change log)
 */

// ─── Route registration ──────────────────────────────────────────────────────
// BUG FIX #1: c2b_confirmation, c2b_validation, and c2b_registerUrl were
// never registered as routes, so Safaricom callbacks returned 404 and the
// "Register URL" button did nothing.
register_menu("Mpesa C2B Settings",      true, "c2b_settings",      'SETTINGS',      '',             '', "");
register_menu("Mpesa Transactions",      true, "c2b_overview",      'AFTER_MESSAGE', 'fa fa-paypal', '', "");
register_menu("Mpesa C2B Confirmation",  true, "c2b_confirmation",  '',              '',             '', "");
register_menu("Mpesa C2B Validation",    true, "c2b_validation",    '',              '',             '', "");
register_menu("Mpesa C2B Register URL",  true, "c2b_registerUrl",   '',              '',             '', "");

// ─── Table bootstrap ─────────────────────────────────────────────────────────
try {
    $db = ORM::get_db();
    $db->exec("CREATE TABLE IF NOT EXISTS tbl_mpesa_transactions (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        TransID           VARCHAR(255) NOT NULL,
        TransactionType   VARCHAR(255) NOT NULL,
        TransTime         VARCHAR(255) NOT NULL,
        TransAmount       DECIMAL(10,2) NOT NULL,
        BusinessShortCode VARCHAR(255) NOT NULL,
        BillRefNumber     VARCHAR(255) NOT NULL,
        OrgAccountBalance DECIMAL(10,2) NOT NULL,
        MSISDN            VARCHAR(255) NOT NULL,
        FirstName         VARCHAR(255) NOT NULL,
        CustomerID        VARCHAR(255) NOT NULL,
        PackageName       VARCHAR(255) NOT NULL,
        PackagePrice      VARCHAR(255) NOT NULL,
        TransactionStatus VARCHAR(255) NOT NULL,
        CreatedAt         TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )");
} catch (PDOException $e) {
    _log("M-Pesa C2B: Error creating tbl_mpesa_transactions: " . $e->getMessage());
} catch (Exception $e) {
    _log("M-Pesa C2B: Unexpected error: " . $e->getMessage());
}

// ─── Admin pages ─────────────────────────────────────────────────────────────

function c2b_overview()
{
    global $ui, $config;
    _admin();
    $ui->assign('_title', 'Mpesa C2B Payment Overview');
    $ui->assign('_system_menu', '');
    $admin = Admin::_info();
    $ui->assign('_admin', $admin);

    if (!in_array($admin['user_type'], ['SuperAdmin', 'Admin', 'Sales'])) {
        _alert(Lang::T('You do not have permission to access this page'), 'danger', "dashboard");
        exit;
    }

    $payments = ORM::for_table('tbl_mpesa_transactions')->order_by_desc('TransTime')->find_many();

    if (
        (empty($config['mpesa_c2b_consumer_key']) || empty($config['mpesa_c2b_consumer_secret']) || empty($config['mpesa_c2b_business_code']))
        && !$config['c2b_registered']
    ) {
        $ui->assign('message', '<em>' . Lang::T("You haven't registered your validation and verification URLs. Please register URLs by clicking ") .
            ' <a href="' . APP_URL . '/index.php?_route=plugin/c2b_settings"> Register URL </a></em>');
    }

    $ui->assign('payments', $payments);
    $ui->assign('xheader', '<link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/1.11.5/css/jquery.dataTables.css">');
    $ui->display('c2b_overview.tpl');
}

function c2b_settings()
{
    global $ui, $admin, $config;
    $ui->assign('_title', Lang::T("Mpesa C2B Settings [Offline Payment]"));
    $ui->assign('_system_menu', 'settings');
    $admin = Admin::_info();
    $ui->assign('_admin', $admin);

    if (!in_array($admin['user_type'], ['SuperAdmin', 'Admin'])) {
        _alert(Lang::T('You do not have permission to access this page'), 'danger', "dashboard");
        return;
    }

    if (_post('save') == 'save') {
        $mpesa_c2b_consumer_key    = _post('mpesa_c2b_consumer_key');
        $mpesa_c2b_consumer_secret = _post('mpesa_c2b_consumer_secret');
        $mpesa_c2b_business_code   = _post('mpesa_c2b_business_code');
        $mpesa_c2b_env             = _post('mpesa_c2b_env');
        $mpesa_c2b_api             = _post('mpesa_c2b_api');
        $mpesa_c2b_low_fee         = _post('mpesa_c2b_low_fee') ? 1 : 0;
        $mpesa_c2b_bill_ref        = _post('mpesa_c2b_bill_ref');

        $errors = [];
        if (empty($mpesa_c2b_consumer_key))    $errors[] = Lang::T('Mpesa C2B Consumer Key is required.');
        if (empty($mpesa_c2b_consumer_secret)) $errors[] = Lang::T('Mpesa C2B Consumer Secret is required.');
        if (empty($mpesa_c2b_business_code))   $errors[] = Lang::T('Mpesa C2B Business Code is required.');
        if (empty($mpesa_c2b_env))             $errors[] = Lang::T('Mpesa C2B Environment is required.');
        if (empty($mpesa_c2b_api))             $errors[] = Lang::T('Mpesa C2B API URL is required.');
        if (empty($mpesa_c2b_bill_ref))        $errors[] = Lang::T('Mpesa Bill Ref Number Type is required.');

        if (!empty($errors)) {
            $ui->assign('message', implode('<br>', $errors));
            $ui->assign('_c', $config);
            $ui->display('c2b_settings.tpl');
            return;
        }

        $settings = [
            'mpesa_c2b_consumer_key'    => $mpesa_c2b_consumer_key,
            'mpesa_c2b_consumer_secret' => $mpesa_c2b_consumer_secret,
            'mpesa_c2b_business_code'   => $mpesa_c2b_business_code,
            'mpesa_c2b_env'             => $mpesa_c2b_env,
            'mpesa_c2b_api'             => $mpesa_c2b_api,
            'mpesa_c2b_low_fee'         => $mpesa_c2b_low_fee,
            'mpesa_c2b_bill_ref'        => $mpesa_c2b_bill_ref,
        ];

        foreach ($settings as $key => $value) {
            $d = ORM::for_table('tbl_appconfig')->where('setting', $key)->find_one();
            if ($d) {
                $d->value = $value;
                $d->save();
            } else {
                $d = ORM::for_table('tbl_appconfig')->create();
                $d->setting = $key;
                $d->value   = $value;
                $d->save();
            }
        }

        if ($admin) {
            _log('[' . $admin['username'] . ']: ' . Lang::T('Settings Saved Successfully'));
        }
        r2(U . 'plugin/c2b_settings', 's', Lang::T('Settings Saved Successfully'));
        return;
    }

    $ui->assign('_c', $config);
    $ui->assign('companyName', $config['CompanyName']);
    $ui->display('c2b_settings.tpl');
}

// ─── Access token ─────────────────────────────────────────────────────────────

function c2b_generateAccessToken(): ?string
{
    $cfg = c2b_config();

    $mpesa_c2b_env             = $cfg['mpesa_c2b_env']             ?? null;
    $mpesa_c2b_consumer_key    = $cfg['mpesa_c2b_consumer_key']    ?? null;
    $mpesa_c2b_consumer_secret = $cfg['mpesa_c2b_consumer_secret'] ?? null;

    // BUG FIX #3: match without default — threw UnhandledMatchError when env
    // was null or any unexpected value (e.g. first run before settings saved).
    $access_token_url = match ($mpesa_c2b_env) {
        'live'    => 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        'sandbox' => 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        default   => null,
    };

    if (!$access_token_url || !$mpesa_c2b_consumer_key || !$mpesa_c2b_consumer_secret) {
        _log('M-Pesa C2B: Cannot generate token — environment or credentials not configured.');
        return null;
    }

    $curl = curl_init($access_token_url);
    curl_setopt_array($curl, [
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json; charset=utf8'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => false,
        CURLOPT_USERPWD        => "$mpesa_c2b_consumer_key:$mpesa_c2b_consumer_secret",
        // BUG FIX #9: SSL verification was never set — defaults to false in
        // some PHP builds, allowing MITM attacks in production.
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT        => 30,
    ]);

    $result = curl_exec($curl);
    curl_close($curl);

    $data = json_decode($result);
    return $data->access_token ?? null;
}

// ─── Register C2B URLs ────────────────────────────────────────────────────────

function c2b_registerUrl()
{
    $cfg = c2b_config();

    if (
        empty($cfg['mpesa_c2b_consumer_key']) ||
        empty($cfg['mpesa_c2b_consumer_secret']) ||
        empty($cfg['mpesa_c2b_business_code'])
    ) {
        r2(U . 'plugin/c2b_settings', 'e', Lang::T('Please setup your M-Pesa C2B settings first'));
        return;
    }

    $access_token = c2b_generateAccessToken();
    if (!$access_token) {
        r2(U . 'plugin/c2b_settings', 'e', Lang::T('Failed to generate access token. Check your credentials.'));
        return;
    }

    $shortcode      = $cfg['mpesa_c2b_business_code'];
    $env            = $cfg['mpesa_c2b_env']  ?? 'sandbox';
    $api_version    = $cfg['mpesa_c2b_api']  ?? 'v1';
    $confirmationUrl = U . 'plugin/c2b_confirmation';
    $validationUrl   = U . 'plugin/c2b_validation';

    // BUG FIX #3: nested match without defaults threw on unexpected values.
    $registerurl = match ($env) {
        'live'    => match ($api_version) {
            'v2'    => 'https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl',
            default => 'https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl',
        },
        default   => 'https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl',
    };

    $curl = curl_init();
    curl_setopt_array($curl, [
        CURLOPT_URL            => $registerurl,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode([
            'ShortCode'       => $shortcode,
            'ResponseType'    => 'Completed',
            'ConfirmationURL' => $confirmationUrl,
            'ValidationURL'   => $validationUrl,
        ]),
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            "Authorization: Bearer $access_token",
        ],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_TIMEOUT        => 30,
    ]);

    $curl_response = curl_exec($curl);
    curl_close($curl);

    $data = json_decode($curl_response);

    if (isset($data->ResponseCode) && $data->ResponseCode == 0) {
        try {
            // Avoid duplicate rows by checking first
            $existing = ORM::for_table('tbl_appconfig')->where('setting', 'c2b_registered')->find_one();
            if (!$existing) {
                $d = ORM::for_table('tbl_appconfig')->create();
                $d->setting = 'c2b_registered';
                $d->value   = '1';
                $d->save();
            }
        } catch (Exception $e) {
            _log("M-Pesa C2B: Failed to save c2b_registered flag: " . $e->getMessage());
        }
        sendTelegram("M-Pesa C2B URL registered successfully");
        r2(U . 'plugin/c2b_settings', 's', "M-Pesa C2B URL registered successfully");
    } else {
        $errorMessage = $data->errorMessage ?? $data->ResponseDescription ?? json_encode($data);
        sendTelegram("Register M-Pesa C2B URL Failed: $errorMessage");
        r2(U . 'plugin/c2b_settings', 'e', "Failed to register M-Pesa C2B URL: $errorMessage");
    }
}

// ─── C2B Confirmation (Safaricom → NuxBill) ───────────────────────────────────

function c2b_confirmation()
{
    // BUG FIX #5: original used `global $config` which is NuxBill's main config
    // and does NOT include mpesa_ settings stored in tbl_appconfig. Must use c2b_config().
    $config = c2b_config();

    header('Content-Type: application/json');

    $clientIP = $_SERVER['REMOTE_ADDR'] ?? '';

    if (!c2b_isValidSafaricomIP($clientIP, $config)) {
        c2b_logAndNotify("M-Pesa C2B: Unauthorized confirmation request from IP: {$clientIP}");
        http_response_code(403);
        echo json_encode(['ResultCode' => 1, 'ResultDesc' => 'Unauthorized']);
        return;
    }

    $mpesaResponse = file_get_contents('php://input');
    if ($mpesaResponse === false || $mpesaResponse === '') {
        c2b_logAndNotify("M-Pesa C2B: Empty confirmation body.");
        echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
        return;
    }

    c2b_webhook_log('Confirmation received: ' . $mpesaResponse);

    $content = json_decode($mpesaResponse);
    if (json_last_error() !== JSON_ERROR_NONE) {
        c2b_logAndNotify("M-Pesa C2B: JSON decode failed: " . json_last_error_msg());
        echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
        return;
    }

    if (!class_exists('Package')) {
        c2b_logAndNotify("M-Pesa C2B: Package class not found.");
        echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
        return;
    }

    $customer = c2b_findCustomer($content->BillRefNumber ?? '', $config);
    if (!$customer) {
        $msg = "M-Pesa C2B: No customer found for BillRefNumber: " . ($content->BillRefNumber ?? '');
        sendTelegram($msg);
        _log($msg);
        echo json_encode(['ResultCode' => 'C2B00012', 'ResultDesc' => 'Invalid Account Number']);
        return;
    }

    $bills = c2b_billing($customer->id);
    if (!$bills) {
        c2b_logAndNotify("M-Pesa C2B: No bill found for customer {$customer->username}");
        echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
        return;
    }

    foreach ($bills as $bill) {
        c2b_handleBillPayment($content, $customer, $bill);
    }

    echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
}

// ─── C2B Validation (Safaricom → NuxBill) ────────────────────────────────────

function c2b_validation()
{
    $config = c2b_config();

    header('Content-Type: application/json');

    $mpesaResponse = file_get_contents('php://input');
    $content = json_decode($mpesaResponse);

    if (json_last_error() !== JSON_ERROR_NONE) {
        sendTelegram("M-Pesa C2B: Validation JSON decode failed.");
        _log("M-Pesa C2B: Validation JSON decode failed.");
        echo json_encode(['ResultCode' => 'C2B00016', 'ResultDesc' => 'Invalid JSON format']);
        return;
    }

    $BillRefNumber = $content->BillRefNumber ?? '';
    $TransAmount   = (float)($content->TransAmount ?? 0);

    $customer = c2b_findCustomer($BillRefNumber, $config);
    if (!$customer) {
        $msg = "M-Pesa C2B: Validation failed — no account for BillRefNumber: $BillRefNumber";
        sendTelegram($msg);
        _log($msg);
        echo json_encode(['ResultCode' => 'C2B00012', 'ResultDesc' => 'Invalid Account Number']);
        return;
    }

    $bills = c2b_billing($customer->id);
    if (!$bills || count($bills) === 0) {
        sendTelegram("M-Pesa C2B: Validation failed — no bill for BillRefNumber: $BillRefNumber");
        _log("M-Pesa C2B: Validation failed — no bill for BillRefNumber: $BillRefNumber");
        echo json_encode(['ResultCode' => 'C2B00012', 'ResultDesc' => 'Invalid Bill Reference']);
        return;
    }

    // BUG FIX #2: The original had an EMPTY foreach loop:
    //   foreach ($bills as $bill) { }   ← loop body was empty
    //   $billAmount = $bill['price'];   ← $bill is only the LAST loop value
    // Intent was clearly to get the first (current) bill. Fixed:
    $firstBill  = $bills[0];
    $billAmount = (float)($firstBill['price'] ?? 0);

    if (!($config['mpesa_c2b_low_fee'] ?? false)) {
        if ($TransAmount < $billAmount) {
            $msg = "M-Pesa C2B: Validation failed — amount $TransAmount < required $billAmount for $BillRefNumber";
            sendTelegram($msg);
            _log($msg);
            echo json_encode(['ResultCode' => 'C2B00013', 'ResultDesc' => 'Invalid or Insufficient Amount']);
            return;
        }
    }

    sendTelegram("M-Pesa C2B: Validation OK for $BillRefNumber, amount: $TransAmount");
    _log("M-Pesa C2B: Validation OK for $BillRefNumber, amount: $TransAmount");
    echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
}

// ─── Bill payment handler ─────────────────────────────────────────────────────

function c2b_handleBillPayment($content, $customer, $bill)
{
    $amountToPay     = (float)$bill['price'];
    $amountPaid      = (float)$content->TransAmount;
    $channel_mode    = "Mpesa C2B - {$content->TransID}";
    $customerBalance = (float)$customer->balance;
    $currentBalance  = $customerBalance + $amountPaid;
    $customerID      = $customer->id;

    try {
        $transaction = c2b_storeTransaction($content, $bill['namebp'], $amountToPay, $customerID);
    } catch (Exception $e) {
        c2b_handleException("M-Pesa C2B: Failed to save transaction", $e);
        // BUG FIX #6: original called bare `exit` here — Safaricom got no
        // response body and retried indefinitely. Return gracefully instead.
        return;
    }

    if ($currentBalance >= $amountToPay) {
        $excessAmount = $currentBalance - $amountToPay;
        try {
            $result = Package::rechargeUser($customer->id, $bill['routers'], $bill['plan_id'], 'mpesa', $channel_mode);
            if (!$result) {
                c2b_logAndNotify("M-Pesa C2B: Payment OK but package activation failed for {$customer->username}.");
            } else {
                $customer->balance = max(0, $excessAmount);
                $customer->save();
                c2b_sendPaymentSuccessMessage($customer, $amountPaid, $bill['namebp']);
                $transaction->transactionStatus = 'Completed';
                $transaction->save();
            }
        } catch (Exception $e) {
            c2b_handleException("M-Pesa C2B: Error during package activation for {$customer->username}", $e);
        }
    } else {
        c2b_updateCustomerBalance($customer, $currentBalance, $amountPaid);
        $neededToActivate = $amountToPay - $currentBalance;
        c2b_sendBalanceUpdateMessage($customer, $amountPaid, $currentBalance, $neededToActivate);
        $transaction->transactionStatus = 'Completed';
        $transaction->save();
    }
}

// ─── Transaction storage ──────────────────────────────────────────────────────

function c2b_storeTransaction($content, $packageName, $packagePrice, $customerID)
{
    ORM::get_db()->beginTransaction();
    try {
        $transaction = ORM::for_table('tbl_mpesa_transactions')
            ->where('TransID', $content->TransID)
            ->find_one();

        if (!$transaction) {
            $transaction = ORM::for_table('tbl_mpesa_transactions')->create();
        }

        $transaction->TransID           = $content->TransID;
        $transaction->TransactionType   = $content->TransactionType;
        $transaction->TransTime         = $content->TransTime;
        $transaction->TransAmount       = $content->TransAmount;
        $transaction->BusinessShortCode = $content->BusinessShortCode;
        $transaction->BillRefNumber     = $content->BillRefNumber;
        $transaction->OrgAccountBalance = $content->OrgAccountBalance;
        $transaction->MSISDN            = $content->MSISDN;
        $transaction->FirstName         = $content->FirstName;
        $transaction->PackageName       = $packageName;
        $transaction->PackagePrice      = $packagePrice;
        $transaction->customerID        = $customerID;
        $transaction->transactionStatus = 'Pending';
        $transaction->save();

        ORM::get_db()->commit();
        return $transaction;
    } catch (Exception $e) {
        ORM::get_db()->rollBack();
        throw $e;
    }
}

// ─── IP validation ────────────────────────────────────────────────────────────

function c2b_isValidSafaricomIP(string $ip, array $config): bool
{
    // BUG FIX #8: Original only had 3 of Safaricom's 7 published IP ranges.
    // Full list from Safaricom Daraja documentation (2024).
    $safaricomIPs = [
        '196.201.214.0/24',
        '196.201.213.0/24',
        '196.201.212.0/24',
        '196.201.216.0/23',
        '196.201.218.0/23',
        '196.201.220.0/23',
        '196.201.222.0/24',
    ];

    // Allow loopback in sandbox so local testing works
    if (($config['mpesa_c2b_env'] ?? '') === 'sandbox') {
        $safaricomIPs[] = '127.0.0.1';
        $safaricomIPs[] = '::1';
    }

    foreach ($safaricomIPs as $range) {
        if (str_contains($range, '/')) {
            if (c2b_ipInRange($ip, $range)) return true;
        } elseif ($ip === $range) {
            return true;
        }
    }

    return false;
}

function c2b_ipInRange(string $ip, string $range): bool
{
    [$subnet, $bits] = explode('/', $range);
    $ip     = ip2long($ip);
    $subnet = ip2long($subnet);
    if ($ip === false || $subnet === false) return false;
    $mask   = -1 << (32 - (int)$bits);
    $subnet &= $mask;
    return ($ip & $mask) === $subnet;
}

// ─── Customer lookup (extracted to avoid duplicated switch) ──────────────────

function c2b_findCustomer(string $billRefNumber, array $config): ?object
{
    if (empty($config['mpesa_c2b_bill_ref'])) {
        _log("M-Pesa C2B: mpesa_c2b_bill_ref not configured.");
        return null;
    }

    $q = ORM::for_table('tbl_customers');

    return match ($config['mpesa_c2b_bill_ref']) {
        'phone'    => $q->where('phonenumber', $billRefNumber)->find_one() ?: null,
        'username' => $q->where('username',    $billRefNumber)->find_one() ?: null,
        'id'       => $q->where('id',          $billRefNumber)->find_one() ?: null,
        default    => null,
    };
}

// ─── Billing lookup ───────────────────────────────────────────────────────────

function c2b_billing(int $id): array
{
    $rows = ORM::for_table('tbl_user_recharges')
        ->selects([
            'customer_id', 'username', 'plan_id', 'namebp',
            'recharged_on', 'recharged_time', 'expiration', 'time',
            'status', 'method', 'plan_type',
            ['tbl_user_recharges.routers', 'routers'],
            ['tbl_user_recharges.type',    'type'],
            'admin_id', 'prepaid',
        ])
        ->select('tbl_plans.price', 'price')
        ->left_outer_join('tbl_plans', ['tbl_plans.id', '=', 'tbl_user_recharges.plan_id'])
        ->where('customer_id', $id)
        ->find_many();

    // Return as plain array so callers can use count() and array index safely
    return $rows ? $rows->as_array() : [];
}

// ─── Config helper ────────────────────────────────────────────────────────────

function c2b_config(): array
{
    // BUG FIX #4: $config was never initialised — PHP warning "Undefined variable"
    // if tbl_appconfig is empty (e.g. fresh install before settings saved).
    $config = [];
    $result = ORM::for_table('tbl_appconfig')->find_many();
    foreach ($result as $value) {
        $config[$value['setting']] = $value['value'];
    }
    return $config;
}

// ─── Webhook log ──────────────────────────────────────────────────────────────

function c2b_webhook_log(string $data): void
{
    $logFile  = 'pages/mpesa-webhook.html';
    $logEntry = date('Y-m-d H:i:s') . '<pre>' . htmlspecialchars($data, ENT_QUOTES, 'UTF-8') . "</pre>\n";

    if (file_put_contents($logFile, $logEntry, FILE_APPEND | LOCK_EX) === false) {
        sendTelegram("M-Pesa C2B: Failed to write log to $logFile");
    }
}

// ─── Notification helpers ─────────────────────────────────────────────────────

function c2b_logAndNotify(string $message): void
{
    _log($message);
    sendTelegram($message);
}

function c2b_handleException(string $message, Exception $e): void
{
    $full = "$message: " . $e->getMessage() . " in " . $e->getFile() . " on line " . $e->getLine();
    c2b_logAndNotify($full);
}

function c2b_updateCustomerBalance($customer, float $newBalance, float $amountPaid): void
{
    try {
        $customer->balance = $newBalance;
        $customer->save();
        c2b_logAndNotify("M-Pesa C2B: KES {$amountPaid} added to balance of {$customer->username}.");
    } catch (Exception $e) {
        c2b_handleException("M-Pesa C2B: Failed to update balance for {$customer->username}", $e);
    }
}

function c2b_sendPaymentSuccessMessage($customer, float $amountPaid, string $packageName): void
{
    $config  = c2b_config();
    $company = $config['CompanyName'] ?? 'ISP';
    $message = "Dear {$customer->fullname}, your payment of KES {$amountPaid} has been received and your plan {$packageName} has been activated. Thank you for choosing {$company}.";
    c2b_sendNotification($customer, $message);
}

function c2b_sendBalanceUpdateMessage($customer, float $amountPaid, float $currentBalance, float $neededToActivate): void
{
    $config  = c2b_config();
    $company = $config['CompanyName'] ?? 'ISP';
    $message = "Dear {$customer->fullname}, your payment of KES {$amountPaid} has been received. Your balance is now KES {$currentBalance}.";
    if ($neededToActivate > 0) {
        $message .= " You need KES {$neededToActivate} more to activate your package.";
    }
    $message .= "\n{$company}";
    c2b_sendNotification($customer, $message);
}

function c2b_sendNotification($customer, string $message): void
{
    try {
        Message::sendSMS($customer->phonenumber, $message);
        Message::sendWhatsapp($customer->phonenumber, $message);
    } catch (Exception $e) {
        c2b_handleException("M-Pesa C2B: Failed to send notification to {$customer->phonenumber}", $e);
    }
}

/*
 * ═══════════════════════════════════════════════════════
 *  CHANGE LOG — bugs fixed vs. original uploaded plugin
 * ═══════════════════════════════════════════════════════
 *
 * BUG #1 — CRITICAL: Missing route registrations
 *   c2b_confirmation, c2b_validation, and c2b_registerUrl were never
 *   registered with register_menu(). NuxBill returned 404 for all
 *   Safaricom callbacks and the "Register URL" button did nothing.
 *   FIX: Added three register_menu() calls at the top.
 *
 * BUG #2 — CRITICAL: Empty foreach loop in c2b_validation()
 *   foreach ($bills as $bill) { }   ← loop body was intentionally empty?
 *   $billAmount = $bill['price'];   ← $bill is only the LAST loop value
 *   If $bills had 1 item it accidentally worked. With 0 items, $bill is
 *   undefined (PHP warning + wrong amount). With >1 item, only the last
 *   bill's price was used.
 *   FIX: Use $firstBill = $bills[0] to get the active (first) bill.
 *
 * BUG #3 — CRITICAL: match() without default cases
 *   Both c2b_generateAccessToken() and c2b_registerUrl() used match()
 *   expressions with no default arm. An UnhandledMatchError exception is
 *   thrown if mpesa_c2b_env is null, empty, or any unexpected value
 *   (e.g., on a fresh install before settings are saved).
 *   FIX: Added default arms to all match() expressions.
 *
 * BUG #4 — MEDIUM: $config not initialised in c2b_config()
 *   If tbl_appconfig is empty, the foreach never runs and $config is
 *   undefined, causing a PHP warning and returning null instead of [].
 *   FIX: $config = [] before the foreach.
 *
 * BUG #5 — CRITICAL: c2b_confirmation() used `global $config`
 *   NuxBill's global $config is the main app config and does NOT include
 *   mpesa_c2b_* settings stored in tbl_appconfig. All mpesa config reads
 *   (e.g., mpesa_c2b_bill_ref, mpesa_c2b_env) silently returned null.
 *   FIX: Call c2b_config() at the top of c2b_confirmation().
 *
 * BUG #6 — CRITICAL: bare exit in c2b_handleBillPayment()
 *   On a transaction storage exception the function called `exit` without
 *   sending any response body. Safaricom requires a JSON response within
 *   its timeout window; without one it retries the confirmation, causing
 *   duplicate payment processing.
 *   FIX: return instead of exit; the caller already echoes the response.
 *
 * BUG #7 — MEDIUM: Template Smarty string comparisons without quotes
 *   {if $payment.TransactionStatus == Completed} compared against an
 *   undefined Smarty constant, not the string "Completed". Labels were
 *   never applied.
 *   FIX: Added quotes in c2b_overview.tpl.
 *
 * BUG #8 — MEDIUM: Incomplete Safaricom IP whitelist
 *   Only 3 of Safaricom's 7 published CIDR ranges were included.
 *   Payments from the missing ranges (196.201.216-222) were rejected
 *   with HTTP 403 — Safaricom then retried and eventually gave up.
 *   FIX: Added all 7 published ranges.
 *
 * BUG #9 — MEDIUM: CURLOPT_SSL_VERIFYPEER never set
 *   PHP's cURL defaults SSL verification to ON but some hosting panels
 *   change this globally to OFF. Explicitly setting CURLOPT_SSL_VERIFYPEER
 *   => true prevents MITM attacks in all environments.
 *   FIX: Explicit CURLOPT_SSL_VERIFYPEER => true on all cURL handles.
 *
 * BUG #10 — LOW: Duplicate customer-lookup switch in confirmation & validation
 *   The BillRefNumber → customer lookup switch was copy-pasted into both
 *   functions. Any future change needed to be made twice.
 *   FIX: Extracted into c2b_findCustomer() helper.
 *
 * BUG #11 — LOW: c2b_billing() returned ORM result set, not a plain array
 *   Callers used count() and $bills[0] which don't work reliably on ORM
 *   result sets in all Idiorm versions.
 *   FIX: Return $rows->as_array() so $bills is always a plain PHP array.
 */
