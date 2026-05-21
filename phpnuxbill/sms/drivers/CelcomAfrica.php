<?php
/**
 * Celcom Africa SMS Driver
 *
 * Docs: https://celcomafrica.com/documentation
 * Signup: https://celcomafrica.com
 *
 * Kenyan SMS provider. Supports Safaricom, Airtel, Telkom.
 * OTP and bulk messaging supported.
 */

defined('_VALID') or die('Direct access not allowed');

class CelcomAfrica extends SmsGateway
{
    private const BASE_URL = 'https://sms.celcomafrica.com/api/services/sendsms/';

    public function send(string $to, string $message): array
    {
        $phone     = $this->normalisePhone($to);
        $apiKey    = defined('CELCOM_API_KEY')    ? CELCOM_API_KEY    : '';
        $partnerId = defined('CELCOM_PARTNER_ID') ? CELCOM_PARTNER_ID : '';
        $shortcode = defined('SMS_SENDER_ID')     ? SMS_SENDER_ID     : 'NETPULSE';

        $body = [
            'apikey'    => $apiKey,
            'partnerID' => $partnerId,
            'message'   => $message,
            'shortcode' => $shortcode,
            'mobile'    => $phone,
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL,
            $body,
            ['Content-Type: application/x-www-form-urlencoded']
        );

        // Response: {"responses":[{"respose-code":200,"response-description":"Success","mobile":"...","messageid":"...","networkid":"..."}]}
        $first = $response['responses'][0] ?? $response;
        $code  = (int)($first['respose-code'] ?? $first['response-code'] ?? $response['_http_code'] ?? 0);
        $desc  = $first['response-description'] ?? $response['message'] ?? '';

        if ($code === 200 || strtolower($desc) === 'success') {
            return [
                'success' => true,
                'message' => "SMS sent via Celcom Africa: {$desc}",
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => "Celcom Africa error ({$code}): {$desc}",
            'data'    => $response,
        ];
    }
}
