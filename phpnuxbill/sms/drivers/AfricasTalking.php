<?php
/**
 * Africa's Talking SMS Driver
 *
 * Docs: https://developers.africastalking.com/docs/sms/sending
 * Signup: https://africastalking.com
 *
 * Supported networks: Safaricom, Airtel, Telkom Kenya, Equitel
 * Coverage: Kenya, Nigeria, Uganda, Tanzania, Rwanda, Ethiopia, Zambia, ...
 */

defined('_VALID') or die('Direct access not allowed');

class AfricasTalking extends SmsGateway
{
    private string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = (defined('AT_ENVIRONMENT') && AT_ENVIRONMENT === 'production')
            ? 'https://api.africastalking.com'
            : 'https://api.sandbox.africastalking.com';
    }

    public function send(string $to, string $message): array
    {
        $phone    = $this->normalisePhone($to);
        $username = defined('AT_USERNAME') ? AT_USERNAME : 'sandbox';
        $apiKey   = defined('AT_API_KEY')  ? AT_API_KEY  : '';
        $from     = defined('SMS_SENDER_ID') ? SMS_SENDER_ID : '';

        $body = [
            'username' => $username,
            'to'       => '+' . $phone,
            'message'  => $message,
        ];

        if (!empty($from) && $username !== 'sandbox') {
            $body['from'] = $from;
        }

        $response = $this->request(
            'POST',
            $this->baseUrl . '/version1/messaging',
            $body,
            [
                'apiKey: '        . $apiKey,
                'Content-Type: application/x-www-form-urlencoded',
                'Accept: application/json',
            ]
        );

        // AT response: {"SMSMessageData":{"Message":"Sent to 1/1 Total Cost: KES 0.8000","Recipients":[{"statusCode":101,...}]}}
        $recipients = $response['SMSMessageData']['Recipients'] ?? [];
        $first      = $recipients[0] ?? [];
        $statusCode = (int)($first['statusCode'] ?? 0);

        // AT status codes: 100 = processed, 101 = sent, 102 = queued
        if (in_array($statusCode, [100, 101, 102], true)) {
            return [
                'success' => true,
                'message' => $response['SMSMessageData']['Message'] ?? 'SMS sent via Africa\'s Talking',
                'data'    => $response,
            ];
        }

        $status = $first['status'] ?? ($response['SMSMessageData']['Message'] ?? 'Unknown error');
        return [
            'success' => false,
            'message' => "Africa's Talking error: {$status}",
            'data'    => $response,
        ];
    }
}
