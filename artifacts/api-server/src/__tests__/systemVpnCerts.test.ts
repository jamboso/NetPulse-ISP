import { describe, expect, it } from "vitest";
import { generateVpnServerCerts } from "../lib/certGen.js";
import {
  INSTALLED_OPENVPN_CERTIFICATE_PATHS,
  loadInstalledOpenVpnCertificates,
} from "../lib/systemVpnCerts.js";

describe("loadInstalledOpenVpnCertificates", () => {
  it("accepts a complete OpenVPN certificate bundle with matching keys", async () => {
    const certs = await generateVpnServerCerts();
    const files = new Map([
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caCert, certs.ca.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caKey, certs.ca.key],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverCert, certs.server.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverKey, certs.server.key],
    ]);

    const bundle = await loadInstalledOpenVpnCertificates(async (path) => files.get(path)!);

    expect(bundle.caCert).toBe(certs.ca.cert);
    expect(bundle.serverCert).toBe(certs.server.cert);
  });

  it("rejects a server certificate issued by a different certificate authority", async () => {
    const trusted = await generateVpnServerCerts();
    const other = await generateVpnServerCerts();
    const files = new Map([
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caCert, trusted.ca.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caKey, trusted.ca.key],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverCert, other.server.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverKey, other.server.key],
    ]);

    await expect(loadInstalledOpenVpnCertificates(async (path) => files.get(path)!))
      .rejects.toThrow("was not issued by the installed CA");
  });
});