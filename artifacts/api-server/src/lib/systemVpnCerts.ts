import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";

export const INSTALLED_OPENVPN_CERTIFICATE_PATHS = {
  caCert: "/etc/openvpn/netpulse/ca.crt",
  caKey: "/etc/openvpn/netpulse-easy-rsa/pki/private/ca.key",
  serverCert: "/etc/openvpn/netpulse/server.crt",
  serverKey: "/etc/openvpn/netpulse/server.key",
} as const;

export interface InstalledOpenVpnCertificates {
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
}

type ReadPemFile = (path: string) => Promise<string>;

async function readPemFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function validateCertificateBundle(bundle: InstalledOpenVpnCertificates): void {
  const ca = new X509Certificate(bundle.caCert);
  const server = new X509Certificate(bundle.serverCert);
  const caKey = createPrivateKey(bundle.caKey);
  const serverKey = createPrivateKey(bundle.serverKey);

  if (!ca.ca) {
    throw new Error("The installed CA certificate is not marked as a certificate authority.");
  }
  if (!ca.checkPrivateKey(caKey)) {
    throw new Error("The installed CA certificate does not match its signing key.");
  }
  if (!server.checkPrivateKey(serverKey)) {
    throw new Error("The installed server certificate does not match its private key.");
  }
  if (!server.checkIssued(ca) || !server.verify(ca.publicKey)) {
    throw new Error("The installed server certificate was not issued by the installed CA.");
  }
}

/**
 * Loads the OpenVPN credentials created by NetPulse's Ubuntu deployment scripts.
 * The caller must never return the result to the browser.
 */
export async function loadInstalledOpenVpnCertificates(
  readPem: ReadPemFile = readPemFile,
): Promise<InstalledOpenVpnCertificates> {
  try {
    const [caCert, caKey, serverCert, serverKey] = await Promise.all([
      readPem(INSTALLED_OPENVPN_CERTIFICATE_PATHS.caCert),
      readPem(INSTALLED_OPENVPN_CERTIFICATE_PATHS.caKey),
      readPem(INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverCert),
      readPem(INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverKey),
    ]);

    const bundle = { caCert, caKey, serverCert, serverKey };
    validateCertificateBundle(bundle);
    return bundle;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown certificate validation error.";
    throw new Error(`Unable to use the installed OpenVPN certificates: ${message}`);
  }
}