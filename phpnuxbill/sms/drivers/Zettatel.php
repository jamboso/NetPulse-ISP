<?php
/**
 * Zettatel SMS Driver
 *
 * Docs: https://portal.zettatel.com/
 * Signup: https://portal.zettatel.com/register
 *
 * Bulk SMS provider supporting Kenya and 160+ countries.
 */

defined('_VALID') or die('Direct access not allowed');

class Zettatel extends SmsGateway
{
    private const BASE_URL = 'https://portal.zettatel.com/SMSApi/send';

    public function send(string $to, string $message): array
    {
        $phone    = $this->normalisePhone($to);
        $userId   = defined('ZETTATEL_USER_ID')  ? ZETTATEL_USER_ID  : '';
        $password = defined('ZETTATEL_PASSWORD') ? ZETTATEL_PASSWORD : '';
        $senderId = defined('ZETTATEL_SENDER_ID') ? ZETTATEL_SENDER_ID : (defined('SMS_SENDER_ID') ? SMS_SENDER_ID : 'NETPULSE');

        $body = [
            'userid'   => $userId,
            'password' => $password,
            'mobile'   => $phone,
            'msg'      => $message,
            'sid'      => $senderId,
            'type'     => 0,        // 0 = plain text, 1 = flash, 2 = unicode
            'output'   => 'json',
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL,
            $body,
            ['Content-Type: application/x-www-form-urlencoded']
        );

        // Response: {"status":"success","id":"...","credits_used":"1"}
        //       or: {"status":"error","message":"Invalid credentials"}
        $status = strtolower($response['status'] ?? '');

        if ($status === 'success' || $status === '1' || (int)($response['_http_code'] ?? 0) === 200) {
            return [
                'success' => true,
                'message' => 'SMS sent via Zettatel. ID: ' . ($response['id'] ?? 'n/a'),
                'data'    => $response,
            ];
        }

        $errMsg = $response['message'] ?? $response['description'] ?? 'Unknown Zettatel error';
        return [
            'success' => false,
            'message' => "Zettatel error: {$errMsg}",
            'data'    => $response,
        ];
    }
}
