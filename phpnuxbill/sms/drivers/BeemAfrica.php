<?php
/**
 * Beem Africa SMS Driver
 *
 * Docs: https://developers.beem.africa/reference/send-sms
 * Signup: https://beem.africa
 *
 * Pan-African SMS platform (Tanzania-founded, strong Kenya presence).
 * Supports Safaricom, Airtel, Telkom Kenya and 40+ countries.
 * Uses HTTP Basic auth (api_key:secret_key base64-encoded).
 */

defined('_VALID') or die('Direct access not allowed');

class BeemAfrica extends SmsGateway
{
    private const BASE_URL = 'https://apisms.beem.africa/v1';

    public function send(string $to, string $message): array
    {
        $phone      = $this->normalisePhone($to);
        $apiKey     = defined('BEEM_API_KEY')    ? BEEM_API_KEY    : '';
        $secretKey  = defined('BEEM_SECRET_KEY') ? BEEM_SECRET_KEY : '';
        $sourceAddr = defined('BEEM_SOURCE_ADDR') ? BEEM_SOURCE_ADDR : (defined('SMS_SENDER_ID') ? SMS_SENDER_ID : 'INFO');

        $credentials = base64_encode($apiKey . ':' . $secretKey);

        $body = [
            'source_addr'   => $sourceAddr,
            'schedule_time' => '',
            'encoding'      => 0,   // 0 = GSM7 (plain text, 160 chars), 8 = UCS2 (unicode)
            'message'       => $message,
            'recipients'    => [
                ['recipient_id' => 1, 'dest_addr' => $phone],
            ],
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL . '/send',
            $body,
            [
                'Authorization: Basic ' . $credentials,
                'Content-Type: application/json',
            ],
            true // JSON body
        );

        // Response: {"successful":true,"request_id":"...","code":100,"message":"Success"}
        //       or: {"successful":false,"code":400,"message":"Invalid credentials"}
        $successful = (bool)($response['successful'] ?? false);
        $code       = (int)($response['code'] ?? 0);

        if ($successful || $code === 100) {
            return [
                'success' => true,
                'message' => 'SMS sent via Beem Africa. Request ID: ' . ($response['request_id'] ?? 'n/a'),
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => 'Beem Africa error (' . $code . '): ' . ($response['message'] ?? 'Unknown error'),
            'data'    => $response,
        ];
    }
}
