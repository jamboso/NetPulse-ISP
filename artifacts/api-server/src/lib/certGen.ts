import forge from "node-forge";

export interface CertBundle {
  cert: string;
  key: string;
}

export interface VpnServerCerts {
  ca: CertBundle;
  server: CertBundle;
}

function makeSerial(): string {
  return Date.now().toString(16).padStart(16, "0");
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
  return `# NetPulse OpenVPN Server Configuration
# Save to: /etc/openvpn/server/netpulse.conf
# Start:   systemctl enable --now openvpn-server@netpulse

port ${opts.port}
proto ${opts.protocol}
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
ifconfig-pool-persist /var/log/openvpn/ipp.txt

push "route ${opts.subnet} ${opts.subnetMask}"
push "dhcp-option DNS ${opts.dns}"

client-to-client
keepalive 10 120

cipher AES-256-GCM
auth SHA256
tls-version-min 1.2

compress lz4-v2
push "compress lz4-v2"

persist-key
persist-tun

status /var/log/openvpn/status.log
log-append /var/log/openvpn/server.log
verb 3

# Enable management interface for status queries
management 127.0.0.1 7505
`;
}

export function generateRosScript(params: {
  routerName: string;
  serverIp: string;
  vpnPort: number;
  vpnProtocol: string;
  vpnSubnet: string;
  caCertPem: string;
  clientCertPem: string;
  clientKeyPem: string;
  radiusSecret: string;
}): string {
  const now = new Date().toISOString();
  const safe = params.routerName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const subnetBase = params.vpnSubnet.split(".").slice(0, 3).join(".");
  const serverVpnIp = `${subnetBase}.1`;

  return `# ============================================================
# NetPulse ISP Manager — MikroTik RouterOS VPN Tunnel Script
# Router:    ${params.routerName}
# Generated: ${now}
# Server:    ${params.serverIp}:${params.vpnPort}/${params.vpnProtocol.toUpperCase()}
# ============================================================
#
# HOW TO APPLY:
#   Option A — Winbox:
#     1. Open Files panel and drag this .rsc file onto it
#     2. Open New Terminal
#     3. Run: /import file-name=netpulse-vpn-${safe}.rsc
#
#   Option B — SSH:
#     1. scp netpulse-vpn-${safe}.rsc admin@ROUTER_IP:
#     2. ssh admin@ROUTER_IP "/import file-name=netpulse-vpn-${safe}.rsc"
#
#   Option C — Paste in terminal:
#     Copy all lines below and paste into RouterOS terminal
# ============================================================

:log info message="NetPulse: starting VPN tunnel setup for ${params.routerName}"
:put "\\n=============================="
:put " NetPulse VPN Tunnel Setup"
:put " Router: ${params.routerName}"
:put "=============================="

# ── 1/6  Remove previous NetPulse config ───────────────────
:put "\\n[1/6] Removing old NetPulse config (if any)..."
/interface ovpn-client remove [find name="netpulse-vpn"] ;
:delay 1s
/certificate remove [find name~"netpulse"] ;
:delay 1s
/file remove [find name~"netpulse-"] ;
:delay 1s

# ── 2/6  Write certificate + key files ──────────────────────
:put "[2/6] Writing certificate files to router storage..."

/file add name="netpulse-ca.pem" contents="${escapePem(params.caCertPem)}"
/file add name="netpulse-client.pem" contents="${escapePem(params.clientCertPem)}"
/file add name="netpulse-client.key" contents="${escapePem(params.clientKeyPem)}"
:delay 2s

# ── 3/6  Import certificates ─────────────────────────────────
:put "[3/6] Importing certificates (allow ~15 seconds)..."

/certificate import file-name="netpulse-ca.pem" passphrase="" name="netpulse-ca"
:delay 4s
/certificate import file-name="netpulse-client.pem" passphrase="" name="netpulse-client"
:delay 4s
/certificate import file-name="netpulse-client.key" passphrase="" name="netpulse-client"
:delay 4s

:local caCert [/certificate find where name="netpulse-ca" and !private-key]
:if ([:len $caCert] = 0) do={
  :log error "NetPulse: CA cert import failed"
  :error "CA certificate import failed — check file format"
}

# ── 4/6  Create OpenVPN client interface ──────────────────────
:put "[4/6] Creating OpenVPN tunnel interface..."

/interface ovpn-client add \\
    name="netpulse-vpn" \\
    connect-to="${params.serverIp}" \\
    port=${params.vpnPort} \\
    mode=ip \\
    protocol=${params.vpnProtocol} \\
    certificate="netpulse-client" \\
    add-default-route=no \\
    disabled=no

:put "Waiting 15 seconds for tunnel to establish..."
:delay 15s

# ── 5/6  Configure RADIUS over VPN for PPPoE auth ─────────────
:put "[5/6] Configuring RADIUS authentication..."

/radius remove [find address="${serverVpnIp}" and service~"ppp"] ;

/radius add \\
    address="${serverVpnIp}" \\
    secret="${params.radiusSecret}" \\
    service=ppp \\
    authentication-port=1812 \\
    accounting-port=1813 \\
    timeout=3000 \\
    realm=""

/ppp aaa set use-radius=yes accounting=yes

# ── 6/6  Add route to NetPulse server via VPN ─────────────────
:put "[6/6] Adding VPN route..."

/ip route remove [find comment="netpulse-radius-route"] ;
/ip route add \\
    dst-address="${serverVpnIp}/32" \\
    gateway="netpulse-vpn" \\
    comment="netpulse-radius-route"

# ── Verify ───────────────────────────────────────────────────
:delay 3s
:local running [/interface ovpn-client get [find name="netpulse-vpn"] running]
:put "\\n=============================="
:if ($running = true) do={
  :put " STATUS: CONNECTED ✓"
  :log info "NetPulse: VPN tunnel ACTIVE"
} else={
  :put " STATUS: NOT CONNECTED"
  :put " Check: firewall rules allow ${params.serverIp}:${params.vpnPort}/${params.vpnProtocol.toUpperCase()}"
  :log warning "NetPulse: VPN tunnel not connected — check server reachability"
}
:put " Server:  ${params.serverIp}:${params.vpnPort}/${params.vpnProtocol.toUpperCase()}"
:put " RADIUS:  ${serverVpnIp}:1812 (via VPN)"
:put "=============================="
:put "\\nCheck tunnel: /interface ovpn-client print"
:put "Check RADIUS: /radius print"
`;
}

function escapePem(pem: string): string {
  return pem.trim().replace(/\n/g, "\\n");
}
