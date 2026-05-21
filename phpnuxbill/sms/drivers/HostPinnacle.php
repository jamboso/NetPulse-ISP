<?php
/**
 * HostPinnacle SMS Driver
 *
 * Docs: https://sms.hostpinnacle.co.ke/documentation
 * Signup: https://sms.hostpinnacle.co.ke
 *
 * Kenyan hosting & SMS provider. Competitive pricing for bulk SMS.
 * Supports Safaricom, Airtel, Telkom networks.
 */

defined('_VALID') or die('Direct access not allowed');

class HostPinnacle extends SmsGateway
{
    private const BASE_URL = 'https://sms.hostpinnacle.co.ke/v3/sms/alphanumeric';

    public function send(string $to, string $message): array
    {
        $phone     = $this->normalisePhone($to);
        $apiKey    = defined('HOSTPINNACLE_API_KEY')    ? HOSTPINNACLE_API_KEY    : '';
        $partnerId = defined('HOSTPINNACLE_PARTNER_ID') ? HOSTPINNACLE_PARTNER_ID : '';
        $shortcode = defined('SMS_SENDER_ID')           ? SMS_SENDER_ID           : 'NETPULSE';

        $body = [
            'partnerID'    => $partnerId,
            'apikey'       => $apiKey,
            'pass_type'    => 'plain',
            'clientsmsid'  => uniqid('np_', true),
            'mobile'       => $phone,
            'message'      => $message,
            'shortcode'    => $shortcode,
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL,
            $body,
            [
                'Content-Type: application/json',
                'hpApiKey: ' . $apiKey,
            ],
            true  // JSON body
        );

        // Response: {"responses":[{"respose-code":200,"response-description":"Success",...}]}
        $first = $response['responses'][0] ?? $response;
        $code  = (int)($first['respose-code'] ?? $first['response-code'] ?? 0);
        $desc  = $first['response-description'] ?? $response['message'] ?? '';

        if ($code === 200 || strtolower($desc) === 'success') {
            return [
                'success' => true,
                'message' => "SMS sent via HostPinnacle: {$desc}",
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => "HostPinnacle error ({$code}): {$desc}",
            'data'    => $response,
        ];
    }
}
