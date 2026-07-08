<?php
/**
 * OnfonMedia (Onfon) SMS Driver
 *
 * Docs: https://onfonmedia.co.ke/documentation
 * Signup: https://onfonmedia.co.ke
 *
 * Popular Kenyan SMS platform for transactional and promotional messages.
 * Registered sender IDs required for alphanumeric shortcodes.
 */

defined('_VALID') or die('Direct access not allowed');

class OnfonMedia extends SmsGateway
{
    private const BASE_URL = 'https://api.onfonmedia.co.ke/v1';

    public function send(string $to, string $message): array
    {
        $phone     = $this->normalisePhone($to);
        $apiKey    = defined('ONFON_API_KEY')    ? ONFON_API_KEY    : '';
        $partnerId = defined('ONFON_PARTNER_ID') ? ONFON_PARTNER_ID : '';
        $clientId  = defined('ONFON_CLIENT_ID')  ? ONFON_CLIENT_ID  : '';
        $shortcode = defined('SMS_SENDER_ID')    ? SMS_SENDER_ID    : 'NETPULSE';

        $body = [
            'SenderId'   => $shortcode,
            'MessageParameters' => [
                [
                    'Number'  => $phone,
                    'Text'    => $message,
                ],
            ],
            'ApiKey'     => $apiKey,
            'ClientId'   => $clientId,
        ];

        $response = $this->request(
            'POST',
            self::BASE_URL . '/sms/SendBulkSMS',
            $body,
            [
                'AccessKey: ' . $apiKey,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            true // JSON body
        );

        // Response: {"ErrorCode":0,"ErrorDescription":"Success","Data":{"MessageId":"...","MessageErrorCode":0,...}}
        $errorCode = (int)($response['ErrorCode'] ?? -1);
        $errorDesc = $response['ErrorDescription'] ?? $response['message'] ?? '';

        if ($errorCode === 0 || strtolower($errorDesc) === 'success') {
            return [
                'success' => true,
                'message' => "SMS sent via OnfonMedia: {$errorDesc}",
                'data'    => $response,
            ];
        }

        return [
            'success' => false,
            'message' => "OnfonMedia error ({$errorCode}): {$errorDesc}",
            'data'    => $response,
        ];
    }
}
