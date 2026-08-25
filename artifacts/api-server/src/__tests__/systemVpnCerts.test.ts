import { describe, expect, it } from "vitest";
import { generateVpnServerCerts } from "../lib/certGen.js";
import {
  INSTALLED_OPENVPN_CERTIFICATE_PATHS,
  loadInstalledOpenVpnCertificates,
  loadInstalledOpenVpnCertificatesWithHelper,
} from "../lib/systemVpnCerts.js";

describe("loadInstalledOpenVpnCertificates", () => {
  it("accepts a complete OpenVPN certificate bundle with matching keys", async () => {
    const certs = await generateVpnServerCerts();
    const files = new Map<string, string>([
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caCert, certs.ca.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caKey, certs.ca.key],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverCert, certs.server.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverKey, certs.server.key],
    ]);

    const bundle = await loadInstalledOpenVpnCertificates(async (path) => files.get(path)!);

    expect(bundle.caCert).toBe(certs.ca.cert);
    expect(bundle.serverCert).toBe(certs.server.cert);
  });

  it("accepts the earlier /etc/openvpn/server/certs layout", async () => {
    const certs = await generateVpnServerCerts();
    const files = new Map<string, string>([
      ["/etc/openvpn/server/certs/ca.crt", certs.ca.cert],
      ["/etc/openvpn/server/certs/ca.key", certs.ca.key],
      ["/etc/openvpn/server/certs/server.crt", certs.server.cert],
      ["/etc/openvpn/server/certs/server.key", certs.server.key],
    ]);

    const bundle = await loadInstalledOpenVpnCertificates(async (path) => {
      const value = files.get(path);
      if (!value) throw new Error("ENOENT");
      return value;
    });

    expect(bundle.caCert).toBe(certs.ca.cert);
    expect(bundle.caKey).toBe(certs.ca.key);
    expect(bundle.serverCert).toBe(certs.server.cert);
    expect(bundle.serverKey).toBe(certs.server.key);
  });

  it("validates an installed bundle returned by the privileged reader", async () => {
    const certs = await generateVpnServerCerts();
    const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");

    const bundle = await loadInstalledOpenVpnCertificatesWithHelper(async () => JSON.stringify({
      caCert: encode(certs.ca.cert),
      caKey: encode(certs.ca.key),
      serverCert: encode(certs.server.cert),
      serverKey: encode(certs.server.key),
    }));

    expect(bundle.caCert).toBe(certs.ca.cert);
    expect(bundle.serverCert).toBe(certs.server.cert);
  });

  it("rejects a server certificate issued by a different certificate authority", async () => {
    const trusted = await generateVpnServerCerts();
    const other = await generateVpnServerCerts();
    const files = new Map<string, string>([
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caCert, trusted.ca.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.caKey, trusted.ca.key],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverCert, other.server.cert],
      [INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverKey, other.server.key],
    ]);

    await expect(loadInstalledOpenVpnCertificates(async (path) => files.get(path)!))
      .rejects.toThrow("was not issued by the installed CA");
  });
});