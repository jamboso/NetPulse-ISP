<?php
/**
 * MobileSasa SMS Driver
 *
 * Docs: https://mobilesasa.com/developers
 * Signup: https://mobilesasa.com
 *
 * Kenyan SMS gateway. Clean REST API with Bearer token auth.
 * Supports OTP, transactional, and bulk SMS.
 */

defined('_VALID') or die('Direct access not allowed');

class MobileSasa extends SmsGateway
{
    private const BASE_URL = 'https://api.mobilesasa.com/v1';

    public function send(string $to, string $message): array
    {
        $phone    = $this->normalisePhone($to);
        $token    = defined('MOBILESASA_TOKEN') ? MOBILESASA_TOKEN : '';
        $senderId = defined('SMS_SENDER_ID')    ? SMS_SENDER_ID    : 'NETPULSE';

        $body = [
            'senderID' => $senderId,
            'message'  => $message,
            'phone'    => $phone,
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL . '/send/message',
            $body,
            [
                'Authorization: Bearer ' . $token,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            true // JSON body
        );

        // Response: {"status":1,"success":true,"message":"Message Sent"}
        //       or: {"status":0,"success":false,"message":"Insufficient balance"}
        $success = (bool)($response['success'] ?? false)
                || $response['status'] === 1
                || $response['status'] === '1';

        if ($success) {
            return [
                'success' => true,
                'message' => 'SMS sent via MobileSasa: ' . ($response['message'] ?? 'OK'),
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => 'MobileSasa error: ' . ($response['message'] ?? 'Unknown error'),
            'data'    => $response,
        ];
    }
}
