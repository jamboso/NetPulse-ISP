import { describe, expect, it } from "vitest";
import { X509Certificate } from "node:crypto";
import { generateClientCert, generateRosScript, generateVpnServerCerts } from "../lib/certGen.js";

describe("generateRosScript", () => {
  const params = {
    routerName: "MAJE_TEMP",
    serverIp: "vpn.example.test",
    vpnPort: 1194,
    vpnProtocol: "tcp",
    vpnSubnet: "10.8.0.0",
    radiusSecret: "test-radius-secret",
  };

  it("escapes Windows-style PEM line endings for RouterOS file contents", () => {
    const pem = "-----BEGIN CERTIFICATE-----\r\nTEST-CERTIFICATE-DATA\r\n-----END CERTIFICATE-----\r\n";

    const script = generateRosScript({
      ...params,
      caCertPem: pem,
      clientCertPem: pem,
      clientKeyPem: pem,
    });

    expect(script).toContain(
      'contents="-----BEGIN CERTIFICATE-----\\nTEST-CERTIFICATE-DATA\\n-----END CERTIFICATE-----"',
    );
    expect(script).not.toContain("\r");
  });

  it("downloads credentials through the provision token when available", () => {
    const script = generateRosScript({
      ...params,
      caCertPem: "CA-SECRET",
      clientCertPem: "CLIENT-CERT-SECRET",
      clientKeyPem: "CLIENT-KEY-SECRET",
      token: "test-provision-token",
      serverUrl: "https://netpulse.example.test",
    });

    expect(script).toContain(
      'url="https://netpulse.example.test/api/provision/test-provision-token/certificate/ca.pem"',
    );
    expect(script).toContain(
      'url="https://netpulse.example.test/api/provision/test-provision-token/certificate/client-private"',
    );
    expect(script).not.toContain("/certificate/client.key");
    expect(script).not.toContain("CLIENT-KEY-SECRET");
    expect(script).toContain('/file remove [find name="netpulse-client.key"]');
    expect(script).not.toContain("protocol=tcp");
    expect(script).toContain(":local addNetpulseOvpn");
    expect(script).toContain("mode=ip certificate=netpulse-client");
    expect(script).toContain(
      'one-session-per-host=yes \\\n  disabled=no \\\n  authentication=mschap2,mschap1,chap,pap',
    );
    expect(script).not.toContain("enabled=yes");
    expect(script).toContain(
      '/interface pppoe-server server remove [find service-name="netpulse-pppoe"]',
    );
    expect(script).not.toContain('comment="netpulse-pppoe"');
    expect(script).toContain('/ip hotspot remove [find name="netpulse-hotspot"]');
    expect(script).not.toContain("radius-address=");
    expect(script).not.toContain("radius-secret=");
    expect(script).not.toContain('comment="netpulse-hotspot"');
    expect(script).not.toContain("mac-auth-mode=");
    expect(script).toContain("user=netpulse");
    expect(script).not.toContain('user=""');
    expect(script).toContain('password=\\"\\"');
    expect(script).toContain(':local netpulseOvpnCipher "aes128"');
    expect(script).toContain(':set netpulseOvpnCipher "aes128-cbc"');
    expect(script).toContain('auth=sha1');
    expect(script).toContain('add-default-route=no route-nopull=yes use-peer-dns=no disabled=no');
    expect(script).toContain('local-address] } on-error={}');
    expect(script).toContain('&vpnIp=" . $vpnIp2');
    expect(script).toContain("timeout=3s");
    expect(script).not.toContain("timeout=3000");
    expect(script).toContain(':parse "/interface ethernet set ether2 master-port=none"');
    expect(script).not.toContain(':do { /interface ethernet set ether2 master-port=none }');
    expect(script).toContain('/interface bridge port remove [find where interface="ether2"]');
    expect(script).toContain('NetPulse: OpenVPN tunnel did not connect');
    expect(script).not.toContain('on-error={ :log warning "NetPulse: ovpn-client already exists" }');
  });

  it("detects the cipher on the router when the bootstrap cannot report its version", () => {
    const script = generateRosScript({
      ...params,
      caCertPem: "CA",
      clientCertPem: "CLIENT-CERT",
      clientKeyPem: "CLIENT-KEY",
    });

    expect(script).toContain("# OVPN cipher: auto-detect at import time");
    expect(script).toContain('[:pick [/system resource get version] 0 1]');
    expect(script).toContain('cipher=" . $netpulseOvpnCipher');
    expect(script).toContain("Waiting up to 60 seconds for the management tunnel");
    expect(script).toContain("RADIUS and customer traffic settings were not changed.");
  });

  it("only emits the protocol property for UDP clients", () => {
    const script = generateRosScript({
      ...params,
      vpnProtocol: "udp",
      caCertPem: "CA",
      clientCertPem: "CLIENT-CERT",
      clientKeyPem: "CLIENT-KEY",
    });

    expect(script).toContain("protocol=udp");
    expect(script).toContain("mode=ip protocol=udp certificate=netpulse-client");
  });

  it("uses the OpenVPN cipher name supported by the reported RouterOS generation", () => {
    const routerOs6Script = generateRosScript({
      ...params,
      routerOsVersion: "6.49.20 (stable)",
      caCertPem: "CA",
      clientCertPem: "CLIENT-CERT",
      clientKeyPem: "CLIENT-KEY",
    });
    const routerOs7Script = generateRosScript({
      ...params,
      routerOsVersion: "7.24 (stable)",
      caCertPem: "CA",
      clientCertPem: "CLIENT-CERT",
      clientKeyPem: "CLIENT-KEY",
    });

    expect(routerOs6Script).toContain("cipher=aes128 \\\n    auth=sha1");
    expect(routerOs6Script).toContain("# OVPN cipher: aes128");
    expect(routerOs6Script).not.toContain("cipher=aes128-cbc");
    expect(routerOs7Script).toContain("cipher=aes128-cbc \\\n    auth=sha1");
    expect(routerOs7Script).toContain("# OVPN cipher: aes128-cbc");
    expect(routerOs7Script).not.toContain("cipher=aes128 \\\n    auth=sha1");
  });
});

describe("VPN certificate generation", () => {
  it("generates certificates accepted by Node's OpenSSL parser", async () => {
    const vpnCerts = await generateVpnServerCerts();
    const clientCert = await generateClientCert("router-test", vpnCerts.ca.cert, vpnCerts.ca.key);

    expect(() => new X509Certificate(vpnCerts.ca.cert)).not.toThrow();
    expect(() => new X509Certificate(vpnCerts.server.cert)).not.toThrow();
    expect(() => new X509Certificate(clientCert.cert)).not.toThrow();
  });
});