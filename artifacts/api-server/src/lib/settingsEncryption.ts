import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/**
 * Notification configuration is encrypted at rest. `SESSION_SECRET` provides
 * a safe existing key source for installations that have not supplied the
 * optional dedicated key yet.
 */
export const notificationSettingKeys = new Set([
  "alertSlackWebhook",
  "alertEmail",
  "smtpHost",
  "smtpPort",
  "smtpUser",
  "smtpPass",
  "smtpFrom",
]);

export const redactedNotificationSettingKeys = new Set([
  "alertSlackWebhook",
  "smtpPass",
]);

function encryptionKey(): Buffer {
  const source = process.env["SETTINGS_ENCRYPTION_KEY"] ?? process.env["SESSION_SECRET"];
  if (!source) {
    throw new Error("Notification settings encryption is unavailable: configure SETTINGS_ENCRYPTION_KEY or SESSION_SECRET");
  }

  return createHash("sha256")
    .update("netpulse:notification-settings:v1")
    .update(source)
    .digest();
}

export function isNotificationSetting(key: string): boolean {
  return notificationSettingKeys.has(key);
}

export function isEncryptedNotificationSetting(value: string): boolean {
  return value.startsWith(`${ENCRYPTION_VERSION}:`);
}

export function encryptNotificationSetting(value: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

/**
 * Plaintext values are supported only as a migration path for values saved
 * before notification settings were encrypted. The next Settings save writes
 * them in the authenticated encrypted format.
 */
export function decryptNotificationSetting(value: string): string {
  if (!value.startsWith(`${ENCRYPTION_VERSION}:`)) return value;

  const [, ivEncoded, tagEncoded, ciphertextEncoded, ...extra] = value.split(":");
  if (!ivEncoded || !tagEncoded || !ciphertextEncoded || extra.length > 0) {
    throw new Error("Stored notification setting has an invalid encrypted format");
  }

  const iv = Buffer.from(ivEncoded, "base64url");
  const tag = Buffer.from(tagEncoded, "base64url");
  const ciphertext = Buffer.from(ciphertextEncoded, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Stored notification setting has an invalid encrypted format");
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored notification setting could not be decrypted");
  }
}