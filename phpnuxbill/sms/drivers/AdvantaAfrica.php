<?php
/**
 * Advanta Africa (QuickSMS) SMS Driver
 *
 * Docs: https://quicksms.advantasms.com/documentation
 * Signup: https://quicksms.advantasms.com
 *
 * Leading Kenyan bulk SMS provider.
 * Delivers to Safaricom, Airtel, and Telkom Kenya.
 * Known for competitive rates and high delivery rates.
 */

defined('_VALID') or die('Direct access not allowed');

class AdvantaAfrica extends SmsGateway
{
    private const BASE_URL = 'https://quicksms.advantasms.com/api';

    public function send(string $to, string $message): array
    {
        $phone     = $this->normalisePhone($to);
        $apiKey    = defined('ADVANTA_API_KEY')    ? ADVANTA_API_KEY    : '';
        $partnerId = defined('ADVANTA_PARTNER_ID') ? ADVANTA_PARTNER_ID : '';
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
            self::BASE_URL . '/services/sendsms/',
            $body,
            ['Content-Type: application/x-www-form-urlencoded']
        );

        // Response: {"responses":[{"respose-code":200,"response-description":"Success","mobile":"...","messageid":"..."}]}
        $first = $response['responses'][0] ?? $response;
        $code  = (int)($first['respose-code'] ?? $first['response-code'] ?? 0);
        $desc  = $first['response-description'] ?? $response['message'] ?? '';

        if ($code === 200 || strtolower($desc) === 'success') {
            return [
                'success' => true,
                'message' => "SMS sent via Advanta Africa: {$desc}",
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => "Advanta Africa error ({$code}): {$desc}",
            'data'    => $response,
        ];
    }
}
