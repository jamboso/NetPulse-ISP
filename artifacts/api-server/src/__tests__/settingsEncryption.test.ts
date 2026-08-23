import { beforeEach, describe, expect, it } from "vitest";
import {
  decryptNotificationSetting,
  encryptNotificationSetting,
  isNotificationSetting,
} from "../lib/settingsEncryption.js";

describe("notification settings encryption", () => {
  beforeEach(() => {
    process.env["SESSION_SECRET"] = "test-session-secret";
    delete process.env["SETTINGS_ENCRYPTION_KEY"];
  });

  it("encrypts values with a versioned authenticated format and decrypts them", () => {
    const plaintext = "https://hooks.slack.com/services/T000/B000/secret";
    const encrypted = encryptNotificationSetting(plaintext);

    expect(encrypted).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptNotificationSetting(encrypted)).toBe(plaintext);
  });

  it("rejects tampered encrypted values", () => {
    const encrypted = encryptNotificationSetting("app-password");
    const tampered = `${encrypted.slice(0, -1)}x`;

    expect(() => decryptNotificationSetting(tampered)).toThrow(
      "Stored notification setting could not be decrypted",
    );
  });

  it("allows legacy plaintext values to be read until the next save migrates them", () => {
    expect(decryptNotificationSetting("old-app-password")).toBe("old-app-password");
  });

  it("only treats notification channel values as encrypted settings", () => {
    expect(isNotificationSetting("smtpPass")).toBe(true);
    expect(isNotificationSetting("alertSlackWebhook")).toBe(true);
    expect(isNotificationSetting("companyName")).toBe(false);
  });
});