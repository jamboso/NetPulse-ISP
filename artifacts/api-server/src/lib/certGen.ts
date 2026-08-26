import forge from "node-forge";
import { randomBytes } from "node:crypto";

export interface CertBundle {
  cert: string;
  key: string;
}

export interface VpnServerCerts {
  ca: CertBundle;
  server: CertBundle;
}

function makeSerial(): string {
  // X.509 serials are DER INTEGERs. They must be positive and minimally
  // encoded; leading zero bytes make OpenSSL reject the certificate.
  const serial = randomBytes(16);
  serial[0] &= 0x7f;
  if (serial[0] === 0) serial[0] = 1;
  return serial.toString("hex");
}

function buildCert(opts: {
  subject: Array<{ name: string; value: string }>;
  issuer: Array<{ name: string; value: string }>;
  publicKey: forge.pki.PublicKey;
  signingKey: forge.pki.rsa.PrivateKey;
  extensions: object[];
  years?: number;
}): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = opts.publicKey;
  cert.serialNumber = makeSerial();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + (opts.years ?? 10));
  cert.setSubject(opts.subject);
  cert.setIssuer(opts.issuer);
  cert.setExtensions(opts.extensions);
  cert.sign(opts.signingKey, forge.md.sha256.create());
  return cert;
}

export async function generateVpnServerCerts(): Promise<VpnServerCerts> {
  return new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, caKeys) => {
      if (err) return reject(err);

      const caAttrs = [
        { name: "commonName", value: "NetPulse CA" },
        { name: "organizationName", value: "NetPulse ISP" },
        { name: "countryName", value: "KE" },
      ];

      const caCert = buildCert({
        subject: caAttrs,
        issuer: caAttrs,
        publicKey: caKeys.publicKey,
        signingKey: caKeys.privateKey as forge.pki.rsa.PrivateKey,
        extensions: [
          { name: "basicConstraints", cA: true, critical: true },
          { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
          { name: "subjectKeyIdentifier" },
        ],
        years: 10,
      });

      forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err2, serverKeys) => {
        if (err2) return reject(err2);

        const serverCert = buildCert({
          subject: [
            { name: "commonName", value: "NetPulse VPN Server" },
            { name: "organizationName", value: "NetPulse ISP" },
          ],
          issuer: caAttrs,
          publicKey: serverKeys.publicKey,
          signingKey: caKeys.privateKey as forge.pki.rsa.PrivateKey,
          extensions: [
            { name: "basicConstraints", cA: false },
            { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
            { name: "extKeyUsage", serverAuth: true },
            { name: "subjectKeyIdentifier" },
          ],
          years: 10,
        });

        resolve({
          ca: {
            cert: forge.pki.certificateToPem(caCert),
            key: forge.pki.privateKeyToPem(caKeys.privateKey),
          },
          server: {
            cert: forge.pki.certificateToPem(serverCert),
            key: forge.pki.privateKeyToPem(serverKeys.privateKey),
          },
        });
      });
    });
  });
}

export async function generateClientCert(
  commonName: string,
  caCertPem: string,
  caKeyPem: string
): Promise<CertBundle> {
  return new Promise((resolve, reject) => {
    const caCert = forge.pki.certificateFromPem(caCertPem);
    const caKey = forge.pki.privateKeyFromPem(caKeyPem);

    forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, clientKeys) => {
      if (err) return reject(err);

      const clientCert = buildCert({
        subject: [
          { name: "commonName", value: commonName },
          { name: "organizationName", value: "NetPulse ISP" },
        ],
        issuer: caCert.subject.attributes as Array<{ name: string; value: string }>,
        publicKey: clientKeys.publicKey,
        signingKey: caKey,
        extensions: [
          { name: "basicConstraints", cA: false },
          { name: "keyUsage", digitalSignature: true, critical: true },
          { name: "extKeyUsage", clientAuth: true },
          { name: "subjectKeyIdentifier" },
        ],
        years: 10,
      });

      resolve({
        cert: forge.pki.certificateToPem(clientCert),
        key: forge.pki.privateKeyToPem(clientKeys.privateKey),
      });
    });
  });
}

export function generateOpenVpnServerConf(opts: {
  port: number;
  protocol: string;
  subnet: string;
  subnetMask: string;
  dns: string;
  caCert: string;
  serverCert: string;
  serverKey: string;
}): string {
  return `# Managed by NetPulse: RouterOS management VPN
# NetPulse OpenVPN Server Configuration
# Save to: /etc/openvpn/server/netpulse.conf
# Start:   systemctl enable --now openvpn-server@netpulse

port ${opts.port}
proto tcp-server
dev tun

# Certificates (inline — no external files needed)
<ca>
${opts.caCert.trim()}
</ca>
<cert>
${opts.serverCert.trim()}
</cert>
<key>
${opts.serverKey.trim()}
</key>

# Use ECDH (no DH params file needed for OpenVPN 2.5+)
dh none
ecdh-curve prime256v1

server ${opts.subnet} ${opts.subnetMask}
ifconfig-pool-persist /var/log/openvpn/netpulse-ipp.txt
writepid /run/openvpn/netpulse-routeros.pid

client-to-client
keepalive 10 120

# RouterOS 6.49 supports only CBC ciphers and SHA1 for OpenVPN.
cipher AES-128-CBC
data-ciphers AES-128-CBC
data-ciphers-fallback AES-128-CBC
auth SHA1
tls-version-min 1.2

persist-key
persist-tun

status /var/log/openvpn/netpulse-status.log
log-append /var/log/openvpn/netpulse-server.log
verb 3

# Enable management interface for status queries
management 127.0.0.1 7505
`;
}

// ── Stage 1: Tiny bootstrap launcher ─────────────────────────────────────────
// Admin pastes one command in RouterOS terminal. The router fetches Stage 2
// from the NetPulse server (identified by token + MAC) and imports it.
export function generateStage1Bootstrap(params: {
  routerName: string;
  token: string;
  serverUrl: string;
}): string {
  const now = new Date().toISOString();
  return `# =================================================================
# NetPulse ISP Manager — Zero-Touch Provisioning Bootstrap
# Router:    ${params.routerName}
# Generated: ${now}
#
# RUN THIS ONE COMMAND IN YOUR RouterOS TERMINAL:
#
# /tool fetch url="${params.serverUrl}/api/provision/${params.token}/bootstrap.rsc" dst-path="np-boot.rsc" mode=https; /import file-name=np-boot.rsc
#
# The router configures itself automatically — no further steps needed.
# =================================================================

:local token "${params.token}"
:local server "${params.serverUrl}"
:local rosVer [:tonum [:pick [/system resource get version] 0 1]]
:local mac [/interface ethernet get 0 mac-address]
:local identity [/system identity get name]

:put ""
:put "======================================"
:put "  NetPulse Zero-Touch Provisioning"
:put "======================================"
:put ("  Router:  " . $identity)
:put ("  MAC:     " . $mac)
:put ("  ROS:     " . [/system resource get version])
:put ""
:put "  Step 1/3: Registering with NetPulse..."

:do {
  /tool fetch \\
    url=($server . "/api/provision/" . $token . "/register?mac=" . $mac . "&ver=" . $rosVer . "&name=" . $identity) \\
    mode=https \\
    keep-result=no
} on-error={ :put "  (registration ping failed — continuing)" }

:delay 3s
:put "  Step 2/3: Downloading secure configuration..."

/tool fetch \\
  url=($server . "/api/provision/" . $token . "/setup.rsc?mac=" . $mac . "&ver=" . $rosVer) \\
  dst-path="netpulse-setup.rsc" \\
  mode=https \\
  keep-result=yes

:delay 2s
:put "  Step 3/3: Applying configuration..."
:put ""
/import file-name=netpulse-setup.rsc
`;
}

// ── Stage 2: Full setup script (served dynamically per router) ────────────────
// Returned by GET /api/provision/:token/setup.rsc
// Configures: OpenVPN tunnel + RADIUS + NETPULSE bridge + PPPoE + Hotspot + callback
export function generateRosScript(params: {
  routerName: string;
  serverIp: string;
  vpnPort: number;
  vpnProtocol: string;
  routerOsVersion?: string;
  vpnSubnet: string;
  caCertPem: string;
  clientCertPem: string;
  clientKeyPem: string;
  radiusSecret: string;
  token?: string;
  serverUrl?: string;
  vpnIp?: string;
}): string {
  const now = new Date().toISOString();
  const subnetBase = params.vpnSubnet.split(".").slice(0, 3).join(".");
  const serverVpnIp = `${subnetBase}.1`;
  // RouterOS 6 uses the legacy `aes128` name while RouterOS 7 requires the
  // OpenVPN-standard `aes128-cbc` name. Stage 1 reports the version before
  // Stage 2 is generated, so the router receives syntax its importer accepts.
  const routerOsMajor = Number.parseInt(params.routerOsVersion?.match(/^\s*(\d+)/)?.[1] ?? "", 10);
  const ovpnCipher = routerOsMajor >= 7 ? "aes128-cbc" : "aes128";
  const hasReportedRouterOsVersion = Number.isFinite(routerOsMajor);
  const ovpnCipherLabel = hasReportedRouterOsVersion
    ? ovpnCipher
    : "auto-detect at import time";
  // RouterOS v6 OpenVPN clients are TCP-only and reject an explicit
  // `protocol=tcp` property. TCP is their default and remains the default on
  // current RouterOS releases, so only emit the property when UDP is requested.
  const ovpnProtocolLine = params.vpnProtocol.toLowerCase() === "udp"
    ? "    protocol=udp \\\n"
    : "";
  const ovpnProtocolParam = params.vpnProtocol.toLowerCase() === "udp"
    ? " protocol=udp"
    : "";
  const ovpnClientBlock = hasReportedRouterOsVersion
    ? `/interface ovpn-client add \\
    name="netpulse-vpn" \\
    connect-to="${params.serverIp}" \\
    port=${params.vpnPort} \\
    mode=ip \\
${ovpnProtocolLine}    certificate="netpulse-client" \\
    user="netpulse" \\
    password="" \\
    cipher=${ovpnCipher} \\
    auth=sha1 \\
    add-default-route=no \\
    route-nopull=yes \\
    use-peer-dns=no \\
    disabled=no`
    : `# The bootstrap normally reports the RouterOS version. If that request was
# blocked or stripped by an upstream proxy, select a compatible cipher locally.
:local netpulseRosMajor [:tonum [:pick [/system resource get version] 0 1]]
:local netpulseOvpnCipher "aes128"
:if ($netpulseRosMajor >= 7) do={ :set netpulseOvpnCipher "aes128-cbc" }

:local addNetpulseOvpn [:parse ("/interface ovpn-client add name=netpulse-vpn connect-to=${params.serverIp} port=${params.vpnPort} mode=ip${ovpnProtocolParam} certificate=netpulse-client user=netpulse password=\\"\\" cipher=" . $netpulseOvpnCipher . " auth=sha1 add-default-route=no route-nopull=yes use-peer-dns=no disabled=no")]
:do { $addNetpulseOvpn } on-error={ :error "NetPulse: could not create an OpenVPN profile compatible with this RouterOS version" }`;
  const certificateFetchBlock = params.token && params.serverUrl
    ? `:put "[2/8] Downloading certificates..."

:do {
  /tool fetch \\
    url="${params.serverUrl}/api/provision/${params.token}/certificate/ca.pem" \\
    dst-path="netpulse-ca.pem" \\
    mode=https
} on-error={ :error "NetPulse: failed to download CA certificate" }

:do {
  /tool fetch \\
    url="${params.serverUrl}/api/provision/${params.token}/certificate/client.pem" \\
    dst-path="netpulse-client.pem" \\
    mode=https
} on-error={ :error "NetPulse: failed to download client certificate" }

:do {
  /tool fetch \\
    url="${params.serverUrl}/api/provision/${params.token}/certificate/client-private" \\
    dst-path="netpulse-client.key" \\
    mode=https
} on-error={ :error "NetPulse: failed to download client private key" }
:delay 2s`
    : `:put "[2/8] Writing certificates..."

/file add name="netpulse-ca.pem"     contents="${escapePem(params.caCertPem)}"
/file add name="netpulse-client.pem" contents="${escapePem(params.clientCertPem)}"
/file add name="netpulse-client.key" contents="${escapePem(params.clientKeyPem)}"
:delay 2s`;

  const callbackBlock = params.token && params.serverUrl
    ? `
# ── 8/8  Signal provisioning complete ────────────────────────────────────────
# Runs only after the tunnel-up retry loop below has given the OpenVPN client
# time to negotiate and be assigned its real local-address — reporting too
# early here previously sent an empty vpnIp, so the server fell back to its
# pre-reserved placeholder IP instead of the router's actual tunnel address.
:put "[8/8] Calling home to NetPulse..."

:local mac2 [/interface ethernet get 0 mac-address]
:local ver2 [:tonum [:pick [/system resource get version] 0 1]]

:do {
  /tool fetch \\
    url=("${params.serverUrl}/api/provision/${params.token}/callback?mac=" . $mac2 . "&ver=" . $ver2 . "&vpnIp=" . $vpnIp2) \\
    dst-path="netpulse-callback-result.txt" \\
    mode=https
} on-error={ :log warning "NetPulse: callback failed — tunnel may still be active" }
:do { /file remove [find name="netpulse-callback-result.txt"] } on-error={}

:log info "NetPulse: provisioning complete"
`
    : "";

  return `# =================================================================
# NetPulse ISP Manager — RouterOS Full Setup (Stage 2)
# Router:    ${params.routerName}
# RouterOS:  ${params.routerOsVersion ?? "version-not-reported"}
# OVPN cipher: ${ovpnCipherLabel}
# Generated: ${now}
# Server:    ${params.serverIp}:${params.vpnPort}/${params.vpnProtocol.toUpperCase()}
${params.vpnIp ? `# VPN IP:    ${params.vpnIp}` : ""}
# =================================================================

:log info message="NetPulse: configuring ${params.routerName}"
:put ""
:put "======================================"
:put "  NetPulse Full Configuration"
:put "  Router: ${params.routerName}"
:put "======================================"

# ── 1/8  Remove previous NetPulse config ─────────────────────────────────────
:put "[1/8] Cleaning old config..."
:do { /interface ovpn-client remove [find name="netpulse-vpn"] } on-error={}
:delay 1s
:do { /certificate remove [find name~"netpulse"] } on-error={}
:delay 1s
:do { /file remove [find name~"netpulse-"] } on-error={}
:delay 1s

# ── 2/8  Retrieve certificate + key files ────────────────────────────────────
${certificateFetchBlock}

# ── 3/8  Import certificates ──────────────────────────────────────────────────
:put "[3/8] Importing certificates (~15 seconds)..."

/certificate import file-name="netpulse-ca.pem"     passphrase="" name="netpulse-ca"
:delay 4s
/certificate import file-name="netpulse-client.pem" passphrase="" name="netpulse-client"
:delay 4s
/certificate import file-name="netpulse-client.key" passphrase="" name="netpulse-client"
:delay 4s

:local caCert [/certificate find where name="netpulse-ca" and !private-key]
:if ([:len $caCert] = 0) do={
  :log error "NetPulse: CA cert import failed"
  :error "CA certificate import failed"
}

# Imported certificates remain in RouterOS's certificate store. Remove the
# temporary plaintext copies, including the client private key, from Files.
:do { /file remove [find name="netpulse-ca.pem"] } on-error={}
:do { /file remove [find name="netpulse-client.pem"] } on-error={}
:do { /file remove [find name="netpulse-client.key"] } on-error={}

# ── 4/8  Create OpenVPN tunnel interface ──────────────────────────────────────
:put "[4/8] Creating OpenVPN tunnel..."

${ovpnClientBlock}

:put "Waiting up to 60 seconds for the management tunnel..."
:local vpnRunning false
:for vpnAttempt from=1 to=12 do={
  :delay 5s
  :do { :set vpnRunning [/interface ovpn-client get [find name="netpulse-vpn"] running] } on-error={}
  :if ($vpnRunning = true) do={ :set vpnAttempt 12 }
}
:if ($vpnRunning = false) do={
  :put "ERROR: NetPulse VPN did not connect. RADIUS and customer traffic settings were not changed."
  :put "Check that ${params.serverIp}:${params.vpnPort}/TCP is publicly reachable and the OpenVPN server is running."
  :do { /interface ovpn-client print detail where name="netpulse-vpn" } on-error={}
  :log error "NetPulse: OpenVPN tunnel did not connect after 60 seconds"
  :error "NetPulse: VPN unavailable — verify endpoint, TCP port ${params.vpnPort}, server service, and certificate"
}

# ── 5/8  Configure RADIUS over VPN ───────────────────────────────────────────
:put "[5/8] Configuring RADIUS..."

:do { /radius remove [find address="${serverVpnIp}" and service~"ppp"] } on-error={}

/radius add \\
  address="${serverVpnIp}" \\
  secret="${params.radiusSecret}" \\
  service=ppp,hotspot \\
  authentication-port=1812 \\
  accounting-port=1813 \\
  timeout=3s \\
  realm=""

/ppp aaa set use-radius=yes accounting=yes

# ── 6/8  Create NETPULSE bridge + PPPoE server + Hotspot server ───────────────
:put "[6/8] Creating NETPULSE bridge + PPPoE + Hotspot..."

# -- Bridge --
:do { /interface bridge remove [find name="NETPULSE"] } on-error={}
:delay 1s
/interface bridge add name="NETPULSE" protocol-mode=rstp comment="netpulse-managed"

# -- Add ether2 as LAN port (default) --
# Older RouterOS versions may keep ether2 as a hardware slave using master-port.
# Parse the legacy-only command at runtime so RouterOS 6.49+ can safely ignore it.
:do {
  :local clearLegacyMasterPort [:parse "/interface ethernet set ether2 master-port=none"]
  $clearLegacyMasterPort
} on-error={}
/interface bridge port remove [find where interface="ether2"]
:delay 1s
/interface bridge port add interface=ether2 bridge=NETPULSE comment="netpulse-lan"

# -- PPPoE server --
:do { /ip pool remove [find name="netpulse-pppoe-pool"] } on-error={}
/ip pool add name="netpulse-pppoe-pool" ranges=10.0.10.1-10.0.10.254

:do { /ppp profile remove [find name="netpulse-profile"] } on-error={}
/ppp profile add \\
  name="netpulse-profile" \\
  local-address=10.0.10.254 \\
  remote-address=netpulse-pppoe-pool \\
  use-encryption=yes \\
  dns-server=8.8.8.8,8.8.4.4

:do { /interface pppoe-server server remove [find service-name="netpulse-pppoe"] } on-error={}
/interface pppoe-server server add \\
  service-name="netpulse-pppoe" \\
  interface=NETPULSE \\
  default-profile=netpulse-profile \\
  one-session-per-host=yes \\
  disabled=no \\
  authentication=mschap2,mschap1,chap,pap

# -- Hotspot --
:do { /ip hotspot remove [find name="netpulse-hotspot"] } on-error={}
:do { /ip hotspot profile remove [find name="netpulse-hs"] } on-error={}
:do { /ip pool remove [find name="netpulse-hs-pool"] } on-error={}
:do { /ip address remove [find comment="netpulse-hs-addr"] } on-error={}
:delay 1s

/ip pool add name="netpulse-hs-pool" ranges=192.168.10.2-192.168.10.254
/ip address add address=192.168.10.1/24 interface=NETPULSE comment="netpulse-hs-addr"
:delay 2s

/ip hotspot profile add \\
  name="netpulse-hs" \\
  hotspot-address=192.168.10.1 \\
  use-radius=yes \\
  login-by=http-chap,mac

/ip hotspot add \\
  name="netpulse-hotspot" \\
  interface=NETPULSE \\
  address-pool=netpulse-hs-pool \\
  profile=netpulse-hs

# ── 7/8  Routing + firewall ───────────────────────────────────────────────────
:put "[7/8] Configuring routing..."

:do { /ip route remove [find comment="netpulse-radius-route"] } on-error={}
/ip route add \\
  dst-address="${serverVpnIp}/32" \\
  gateway="netpulse-vpn" \\
  comment="netpulse-radius-route"

:do {
  /ip firewall filter add \\
    chain=input \\
    in-interface="netpulse-vpn" \\
    protocol=udp \\
    dst-port=1812-1813 \\
    action=accept \\
    comment="netpulse-radius-in" \\
    place-before=0
} on-error={}

# ── Verify tunnel is up before reporting its address ─────────────────────────
# Poll for up to ~12s (OpenVPN negotiation can take longer than a fixed 3s
# wait) so the callback below reports the tunnel's real assigned IP instead
# of firing before local-address is populated.
:local running false
:local vpnIp2 ""
:local attempt 0
:while ($attempt < 6 && $running = false) do={
  :delay 2s
  :do { :set running [/interface ovpn-client get [find name="netpulse-vpn"] running] } on-error={}
  :set attempt ($attempt + 1)
}
:do { :set vpnIp2 [/interface ovpn-client get [find name="netpulse-vpn"] local-address] } on-error={}
${callbackBlock}
:put ""
:put "======================================"
:if ($running = true) do={
  :put "  STATUS: CONNECTED"
  :log info "NetPulse: VPN tunnel ACTIVE"
} else={
  :put "  STATUS: NOT YET CONNECTED"
  :put "  Verify ${params.serverIp}:${params.vpnPort} is reachable"
  :log warning "NetPulse: VPN not yet connected"
}
:put "  Server:  ${params.serverIp}:${params.vpnPort}/${params.vpnProtocol.toUpperCase()}"
:put "  RADIUS:  ${serverVpnIp}:1812 (via VPN)"
:put "  Bridge:  NETPULSE (ether2 + PPPoE + Hotspot)"
:put "  PPPoE:   pool 10.0.10.1-254 on NETPULSE"
:put "  Hotspot: 192.168.10.1/24 on NETPULSE"
:put "======================================"
:put ""
:put "Check: /interface ovpn-client print"
:put "Check: /interface bridge port print"
:put "Check: /interface pppoe-server server print"
:put "Check: /ip hotspot print"
`;
}

function escapePem(pem: string): string {
  return pem.trim().replace(/\r\n?|\n/g, "\\n");
}
