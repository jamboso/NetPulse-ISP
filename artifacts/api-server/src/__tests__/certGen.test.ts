import { describe, expect, it } from "vitest";
import { generateRosScript } from "../lib/certGen.js";

describe("generateRosScript", () => {
  it("escapes Windows-style PEM line endings for RouterOS file contents", () => {
    const pem = "-----BEGIN CERTIFICATE-----\r\nTEST-CERTIFICATE-DATA\r\n-----END CERTIFICATE-----\r\n";

    const script = generateRosScript({
      routerName: "MAJE_TEMP",
      serverIp: "vpn.example.test",
      vpnPort: 1194,
      vpnProtocol: "tcp",
      vpnSubnet: "10.8.0.0",
      caCertPem: pem,
      clientCertPem: pem,
      clientKeyPem: pem,
      radiusSecret: "test-radius-secret",
    });

    expect(script).toContain(
      'contents="-----BEGIN CERTIFICATE-----\\nTEST-CERTIFICATE-DATA\\n-----END CERTIFICATE-----"',
    );
    expect(script).not.toContain("\r");
  });
});