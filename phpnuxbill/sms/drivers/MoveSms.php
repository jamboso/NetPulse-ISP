<?php
/**
 * MoveSMS Driver
 *
 * Docs: https://movesms.co.ke/developers
 * Signup: https://movesms.co.ke
 *
 * Kenyan bulk SMS platform supporting Safaricom, Airtel, Telkom.
 */

defined('_VALID') or die('Direct access not allowed');

class MoveSms extends SmsGateway
{
    private const BASE_URL = 'https://api.movesms.co.ke/v1';

    public function send(string $to, string $message): array
    {
        $phone     = $this->normalisePhone($to);
        $apiKey    = defined('MOVESMS_API_KEY')    ? MOVESMS_API_KEY    : '';
        $partnerId = defined('MOVESMS_PARTNER_ID') ? MOVESMS_PARTNER_ID : '';
        $shortcode = defined('SMS_SENDER_ID')      ? SMS_SENDER_ID      : 'NETPULSE';

        $body = [
            'apikey'    => $apiKey,
            'partnerID' => $partnerId,
            'message'   => $message,
            'shortcode' => $shortcode,
            'mobile'    => $phone,
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL . '/sms/sendsms',
            $body,
            ['Content-Type: application/x-www-form-urlencoded']
        );

        // Response: {"responses":[{"respose-code":200,"response-description":"Success","mobile":"254XXXXXXXXX",...}]}
        $first      = ($response['responses'][0] ?? $response);
        $code       = (int)($first['respose-code'] ?? $first['response-code'] ?? 0);
        $description = $first['response-description'] ?? ($response['message'] ?? '');

        if ($code === 200 || strtolower($description) === 'success') {
            return [
                'success' => true,
                'message' => "SMS sent via MoveSMS: {$description}",
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => "MoveSMS error ({$code}): {$description}",
            'data'    => $response,
        ];
    }
}
