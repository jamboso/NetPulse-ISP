<?php
/**
 * Safaricom Daraja API client
 * Handles access token generation and STK Push requests.
 */

defined('_VALID') or die('Direct access not allowed');

class MpesaAPI
{
    private string $consumerKey;
    private string $consumerSecret;
    private string $baseUrl;

    public function __construct(string $consumerKey, string $consumerSecret, string $environment = 'sandbox')
    {
        $this->consumerKey    = $consumerKey;
        $this->consumerSecret = $consumerSecret;
        $this->baseUrl        = $environment === 'production'
            ? 'https://api.safaricom.co.ke'
            : 'https://sandbox.safaricom.co.ke';
    }

    /**
     * Fetch an OAuth 2.0 access token from Daraja.
     *
     * @throws RuntimeException on failure
     */
    public function getAccessToken(): string
    {
        $credentials = base64_encode($this->consumerKey . ':' . $this->consumerSecret);
        $response    = $this->request(
            'GET',
            '/oauth/v1/generate?grant_type=client_credentials',
            [],
            ['Authorization: Basic ' . $credentials]
        );

        if (empty($response['access_token'])) {
            throw new RuntimeException('Failed to obtain M-Pesa access token: ' . json_encode($response));
        }

        return $response['access_token'];
    }

    /**
     * Initiate an STK Push (Lipa Na M-Pesa Online).
     *
     * @param string $shortcode   Business Short Code (PayBill / Till number)
     * @param string $passkey     Lipa Na M-Pesa Online passkey from Daraja
     * @param int    $amount      Amount in KES (whole number)
     * @param string $phone       Customer phone in format 2547XXXXXXXX
     * @param string $callbackUrl Publicly accessible HTTPS URL
     * @param string $accountRef  Account reference (e.g. invoice number)
     * @param string $description Transaction description shown to customer
     */
    public function stkPush(
        string $shortcode,
        string $passkey,
        int    $amount,
        string $phone,
        string $callbackUrl,
        string $accountRef  = 'Payment',
        string $description = 'ISP Payment'
    ): array {
        $token     = $this->getAccessToken();
        $timestamp = date('YmdHis');
        $password  = base64_encode($shortcode . $passkey . $timestamp);

        return $this->request(
            'POST',
            '/mpesa/stkpush/v1/processrequest',
            [
                'BusinessShortCode' => $shortcode,
                'Password'          => $password,
                'Timestamp'         => $timestamp,
                'TransactionType'   => 'CustomerPayBillOnline',
                'Amount'            => $amount,
                'PartyA'            => $phone,
                'PartyB'            => $shortcode,
                'PhoneNumber'       => $phone,
                'CallBackURL'       => $callbackUrl,
                'AccountReference'  => $accountRef,
                'TransactionDesc'   => $description,
            ],
            ['Authorization: Bearer ' . $token, 'Content-Type: application/json']
        );
    }

    /**
     * Query the status of an STK Push transaction.
     *
     * @param string $shortcode          Business Short Code
     * @param string $passkey            Lipa Na M-Pesa passkey
     * @param string $checkoutRequestId  CheckoutRequestID from the STK Push response
     */
    public function stkQuery(string $shortcode, string $passkey, string $checkoutRequestId): array
    {
        $token     = $this->getAccessToken();
        $timestamp = date('YmdHis');
        $password  = base64_encode($shortcode . $passkey . $timestamp);

        return $this->request(
            'POST',
            '/mpesa/stkpushquery/v1/query',
            [
                'BusinessShortCode'  => $shortcode,
                'Password'           => $password,
                'Timestamp'          => $timestamp,
                'CheckoutRequestID'  => $checkoutRequestId,
            ],
            ['Authorization: Bearer ' . $token, 'Content-Type: application/json']
        );
    }

    /**
     * Register C2B validation and confirmation URLs.
     *
     * @param string $shortcode       Business Short Code
     * @param string $validationUrl   Your validation endpoint
     * @param string $confirmationUrl Your confirmation endpoint
     * @param string $responseType    'Completed' or 'Cancelled'
     */
    public function registerC2BUrls(
        string $shortcode,
        string $validationUrl,
        string $confirmationUrl,
        string $responseType = 'Completed'
    ): array {
        $token = $this->getAccessToken();

        return $this->request(
            'POST',
            '/mpesa/c2b/v1/registerurl',
            [
                'ShortCode'       => $shortcode,
                'ResponseType'    => $responseType,
                'ConfirmationURL' => $confirmationUrl,
                'ValidationURL'   => $validationUrl,
            ],
            ['Authorization: Bearer ' . $token, 'Content-Type: application/json']
        );
    }

    // ----------------------------------------------------------------
    // Internal helpers
    // ----------------------------------------------------------------

    /**
     * @param string   $method   HTTP method ('GET' or 'POST')
     * @param string   $path     API path (e.g. '/oauth/v1/generate...')
     * @param array    $body     Request body (encoded as JSON for POST)
     * @param string[] $headers  Additional HTTP headers
     */
    private function request(string $method, string $path, array $body = [], array $headers = []): array
    {
        $url = $this->baseUrl . $path;
        $ch  = curl_init($url);

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_HTTPHEADER     => $headers,
        ]);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $raw   = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        curl_close($ch);

        if ($errno) {
            throw new RuntimeException('cURL error ' . $errno . ': ' . $error);
        }

        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : ['raw' => $raw];
    }
}
