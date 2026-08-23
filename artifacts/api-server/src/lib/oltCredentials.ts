import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type OltManagementCredentials = {
  username?: string;
  secret: string;
};

function encryptionKey(): Buffer {
  const source = process.env["OLT_CREDENTIALS_ENCRYPTION_KEY"] ?? process.env["SESSION_SECRET"];
  if (!source) {
    throw new Error("OLT credential encryption is unavailable: configure OLT_CREDENTIALS_ENCRYPTION_KEY or SESSION_SECRET");
  }

  return createHash("sha256")
    .update("netpulse:olt-management-credentials:v1")
    .update(source)
    .digest();
}

export function encryptOltCredentials(credentials: OltManagementCredentials): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = JSON.stringify(credentials);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptOltCredentials(value: string): OltManagementCredentials {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = value.split(":");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
    throw new Error("Stored OLT credentials have an invalid encrypted format");
  }

  const iv = Buffer.from(encodedIv, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Stored OLT credentials have an invalid encrypted format");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || typeof (parsed as OltManagementCredentials).secret !== "string") {
      throw new Error("Stored OLT credentials are invalid");
    }
    return parsed as OltManagementCredentials;
  } catch {
    throw new Error("Stored OLT credentials could not be decrypted");
  }
}