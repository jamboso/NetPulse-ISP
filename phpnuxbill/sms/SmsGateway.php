<?php
/**
 * SmsGateway — base class and driver dispatcher.
 *
 * All drivers extend this class and implement send().
 * The static dispatch() method picks the right driver based on SMS_PROVIDER.
 */

defined('_VALID') or die('Direct access not allowed');

abstract class SmsGateway
{
    /**
     * Send an SMS.
     *
     * @param  string $to      Recipient phone, e.g. "0712345678" or "+254712345678"
     * @param  string $message SMS body text
     * @return array  ['success' => bool, 'message' => string, 'data' => array]
     */
    abstract public function send(string $to, string $message): array;

    // ----------------------------------------------------------------
    // Shared helpers available to all drivers
    // ----------------------------------------------------------------

    /**
     * Normalise a Kenyan phone number to international format (2547XXXXXXXX).
     * Handles 07XXXXXXXX, 7XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX.
     * Also handles 01XXXXXXXX (Airtel/Telkom 011…).
     */
    protected function normalisePhone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone);

        // Already international: 2547... or 2541...
        if (strlen($digits) === 12 && str_starts_with($digits, '254')) {
            return $digits;
        }
        // Local with leading zero: 07... or 01...
        if (strlen($digits) === 10 && str_starts_with($digits, '0')) {
            return '254' . substr($digits, 1);
        }
        // Without leading zero: 7... or 1...
        if (strlen($digits) === 9) {
            return '254' . $digits;
        }

        return $digits; // return as-is; provider will reject invalid numbers
    }

    /**
     * Execute a cURL request and return the decoded JSON response.
     *
     * @param  string   $method   'GET' | 'POST'
     * @param  string   $url      Full endpoint URL
     * @param  mixed    $body     Array (form or JSON) or null
     * @param  string[] $headers  HTTP headers
     * @param  bool     $jsonBody Whether to encode body as JSON (default: false → form-encoded)
     */
    protected function request(
        string $method,
        string $url,
        mixed  $body    = null,
        array  $headers = [],
        bool   $jsonBody = false
    ): array {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_TIMEOUT        => 20,
            CURLOPT_HTTPHEADER     => $headers,
        ]);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            if ($body !== null) {
                curl_setopt(
                    $ch,
                    CURLOPT_POSTFIELDS,
                    $jsonBody ? json_encode($body) : http_build_query($body)
                );
            }
        }

        $raw   = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($errno) {
            throw new RuntimeException("cURL error {$errno}: {$error}");
        }

        $decoded = json_decode($raw, true);
        $data    = is_array($decoded) ? $decoded : ['raw' => $raw];
        $data['_http_code'] = $code;

        return $data;
    }

    // ----------------------------------------------------------------
    // Factory / dispatcher
    // ----------------------------------------------------------------

    /**
     * Return the correct driver instance for the configured SMS_PROVIDER.
     */
    public static function make(): self
    {
        $driver = defined('SMS_PROVIDER') ? SMS_PROVIDER : 'africas_talking';
        $map    = [
            'africas_talking' => 'AfricasTalking',
            'movesms'         => 'MoveSms',
            'zettatel'        => 'Zettatel',
            'celcom_africa'   => 'CelcomAfrica',
            'hostpinnacle'    => 'HostPinnacle',
            'mobilesasa'      => 'MobileSasa',
            'onfonmedia'      => 'OnfonMedia',
            'beem_africa'     => 'BeemAfrica',
            'advanta_africa'  => 'AdvantaAfrica',
        ];

        if (!isset($map[$driver])) {
            throw new RuntimeException("Unknown SMS provider: {$driver}");
        }

        $class = $map[$driver];
        $file  = __DIR__ . "/drivers/{$class}.php";

        if (!file_exists($file)) {
            throw new RuntimeException("Driver file not found: {$file}");
        }

        require_once $file;
        return new $class();
    }
}
