import { describe, expect, it } from "vitest";
import { generateRosScript } from "../lib/certGen.js";

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
      'url="https://netpulse.example.test/api/provision/test-provision-token/certificate/client.key"',
    );
    expect(script).not.toContain("CLIENT-KEY-SECRET");
    expect(script).toContain('/file remove [find name="netpulse-client.key"]');
    expect(script).not.toContain("protocol=tcp");
    expect(script).toContain('mode=ip \\\n    certificate="netpulse-client"');
    expect(script).toContain(
      'one-session-per-host=yes \\\n  disabled=no \\\n  authentication=mschap2,mschap1,chap,pap',
    );
    expect(script).not.toContain("enabled=yes");
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
    expect(script).toContain('mode=ip \\\n    protocol=udp \\\n    certificate="netpulse-client"');
  });
});