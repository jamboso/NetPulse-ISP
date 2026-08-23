import { describe, expect, it } from "vitest";
import { decryptOltCredentials, encryptOltCredentials } from "../lib/oltCredentials";

describe("OLT credential encryption", () => {
  it("round-trips management credentials using authenticated encryption", () => {
    const encrypted = encryptOltCredentials({ username: "snmp-admin", secret: "private-community" });

    expect(encrypted).not.toContain("snmp-admin");
    expect(encrypted).not.toContain("private-community");
    expect(decryptOltCredentials(encrypted)).toEqual({
      username: "snmp-admin",
      secret: "private-community",
    });
  });

  it("rejects a tampered credential payload", () => {
    const encrypted = encryptOltCredentials({ secret: "private-community" });
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith("A") ? "B" : "A"}`;

    expect(() => decryptOltCredentials(tampered)).toThrow("could not be decrypted");
  });
});