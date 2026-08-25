import { createPrivateKey, X509Certificate } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

export const INSTALLED_OPENVPN_CERTIFICATE_PATHS = {
  caCert: "/etc/openvpn/netpulse/ca.crt",
  caKey: "/etc/openvpn/netpulse-easy-rsa/pki/private/ca.key",
  serverCert: "/etc/openvpn/netpulse/server.crt",
  serverKey: "/etc/openvpn/netpulse/server.key",
} as const;

// NetPulse has two supported on-host layouts:
// - the current installer keeps its PKI under /etc/openvpn/netpulse*
// - earlier NetPulse installs keep the active service certificates under
//   /etc/openvpn/server/certs while the EasyRSA CA key remains nearby
const INSTALLED_OPENVPN_CERTIFICATE_CANDIDATES = {
  caCert: [
    INSTALLED_OPENVPN_CERTIFICATE_PATHS.caCert,
    "/etc/openvpn/server/certs/ca.crt",
  ],
  caKey: [
    INSTALLED_OPENVPN_CERTIFICATE_PATHS.caKey,
    "/etc/openvpn/server/certs/ca.key",
    "/etc/openvpn/server/easy-rsa/pki/private/ca.key",
    "/etc/openvpn/easy-rsa/pki/private/ca.key",
  ],
  serverCert: [
    INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverCert,
    "/etc/openvpn/server/certs/server.crt",
  ],
  serverKey: [
    INSTALLED_OPENVPN_CERTIFICATE_PATHS.serverKey,
    "/etc/openvpn/server/certs/server.key",
  ],
} as const;

export interface InstalledOpenVpnCertificates {
  caCert: string;
  caKey: string;
  serverCert: string;
  serverKey: string;
}

type ReadPemFile = (path: string) => Promise<string>;
type RunCertificateReader = () => Promise<string>;

const CERTIFICATE_READER_HELPER = "/usr/local/bin/netpulse-vpn-read-certificates";

async function readPemFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

function runCertificateReader(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "sudo",
      ["-n", CERTIFICATE_READER_HELPER, "--json"],
      { encoding: "utf8", timeout: 20_000, maxBuffer: 128 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr).trim() || "The NetPulse certificate reader could not run."));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

async function readFirstAvailable(
  paths: readonly string[],
  readPem: ReadPemFile,
  label: string,
): Promise<string> {
  let lastError: unknown;
  for (const path of paths) {
    try {
      return await readPem(path);
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Installed OpenVPN ${label} was not found${detail}`);
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
      readFirstAvailable(INSTALLED_OPENVPN_CERTIFICATE_CANDIDATES.caCert, readPem, "CA certificate"),
      readFirstAvailable(INSTALLED_OPENVPN_CERTIFICATE_CANDIDATES.caKey, readPem, "CA signing key"),
      readFirstAvailable(INSTALLED_OPENVPN_CERTIFICATE_CANDIDATES.serverCert, readPem, "server certificate"),
      readFirstAvailable(INSTALLED_OPENVPN_CERTIFICATE_CANDIDATES.serverKey, readPem, "server private key"),
    ]);

    const bundle = { caCert, caKey, serverCert, serverKey };
    validateCertificateBundle(bundle);
    return bundle;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown certificate validation error.";
    throw new Error(`Unable to use the installed OpenVPN certificates: ${message}`);
  }
}

/**
 * Reads the certificate bundle through the fixed root-owned helper. The caller
 * keeps the private material server-side and must never include it in a response.
 */
export async function loadInstalledOpenVpnCertificatesWithHelper(
  runReader: RunCertificateReader = runCertificateReader,
): Promise<InstalledOpenVpnCertificates> {
  try {
    const parsed = JSON.parse(await runReader()) as Partial<Record<keyof InstalledOpenVpnCertificates, string>>;
    const decode = (value: unknown, label: string): string => {
      if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        throw new Error(`The NetPulse certificate reader returned an invalid ${label}.`);
      }
      return Buffer.from(value, "base64").toString("utf8");
    };

    const bundle: InstalledOpenVpnCertificates = {
      caCert: decode(parsed.caCert, "CA certificate"),
      caKey: decode(parsed.caKey, "CA signing key"),
      serverCert: decode(parsed.serverCert, "server certificate"),
      serverKey: decode(parsed.serverKey, "server private key"),
    };
    validateCertificateBundle(bundle);
    return bundle;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown certificate reader error.";
    throw new Error(`Unable to use the installed OpenVPN certificates: ${message}`);
  }
}