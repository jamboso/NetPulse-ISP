import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type Tr069AcsCredentials = {
  username: string;
  password: string;
};

function encryptionKey(): Buffer {
  const source = process.env["TR069_ACS_CREDENTIALS_ENCRYPTION_KEY"] ?? process.env["SESSION_SECRET"];
  if (!source) {
    throw new Error("TR-069 ACS credential encryption is unavailable: configure TR069_ACS_CREDENTIALS_ENCRYPTION_KEY or SESSION_SECRET");
  }
  return createHash("sha256")
    .update("netpulse:tr069-acs-nbi-credentials:v1")
    .update(source)
    .digest();
}

export function encryptTr069AcsCredentials(credentials: Tr069AcsCredentials): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptTr069AcsCredentials(value: string): Tr069AcsCredentials {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = value.split(":");
  if (version !== VERSION || !encodedIv || !encodedTag || !encodedCiphertext || extra.length > 0) {
    throw new Error("Stored TR-069 ACS credentials have an invalid encrypted format");
  }
  const iv = Buffer.from(encodedIv, "base64url");
  const tag = Buffer.from(encodedTag, "base64url");
  const ciphertext = Buffer.from(encodedCiphertext, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Stored TR-069 ACS credentials have an invalid encrypted format");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const parsed = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || typeof (parsed as Tr069AcsCredentials).username !== "string" || typeof (parsed as Tr069AcsCredentials).password !== "string") {
      throw new Error("Stored TR-069 ACS credentials are invalid");
    }
    return parsed as Tr069AcsCredentials;
  } catch {
    throw new Error("Stored TR-069 ACS credentials could not be decrypted");
  }
}