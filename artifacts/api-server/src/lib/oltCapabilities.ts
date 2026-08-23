import type { OltAdapterInput } from "./oltAdapters";

export type OltCapability = {
  status: "mib-validated-read-only" | "standard-identity-read-only" | "recognized-read-only" | "unsupported";
  discoveryEnabled: boolean;
  provisioningEnabled: false;
  adapter: "hioso-epon-mib" | "hioso-gpon-identity" | "none";
  message: string;
};

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

function isHioso(input: Pick<OltAdapterInput, "vendor">): boolean {
  return normalized(input.vendor) === "HIOSO";
}

/**
 * The compatibility registry makes the distinction between models that are
 * known to exist and profiles whose inventory MIB has been verified. It does
 * not authorize configuration writes; no HIOSO write profile has been
 * lab-validated yet.
 */
export function getOltCapability(input: Pick<OltAdapterInput, "vendor" | "model" | "firmwareVersion" | "ponTechnology" | "managementProtocol">): OltCapability {
  if (!isHioso(input)) {
    return {
      status: "unsupported",
      discoveryEnabled: false,
      provisioningEnabled: false,
      adapter: "none",
      message: "No vendor adapter is registered for this OLT. Only safe management-port checks are available.",
    };
  }

  const model = normalized(input.model);
  const firmware = normalized(input.firmwareVersion);
  const is7304V = model === "HA7304V" || model === "HA7304VD";
  const isValidatedFirmware = firmware === "V1.1.28" || firmware === "1.1.28";
  if (is7304V && input.ponTechnology === "epon" && input.managementProtocol === "snmp-v2c" && isValidatedFirmware) {
    return {
      status: "mib-validated-read-only",
      discoveryEnabled: true,
      provisioningEnabled: false,
      adapter: "hioso-epon-mib",
      message: "HIOSO EPON inventory discovery is enabled for this MIB-validated profile. Provisioning remains disabled until an exact write workflow is lab-validated.",
    };
  }

  if (model.startsWith("HA7304GJ") && input.ponTechnology === "gpon" && input.managementProtocol === "snmp-v2c") {
    return {
      status: "standard-identity-read-only",
      discoveryEnabled: true,
      provisioningEnabled: false,
      adapter: "hioso-gpon-identity",
      message: "Only standard SNMP system identity discovery is enabled for this GPON profile. No GPON vendor MIB, ONU inventory, provisioning, or rollback control has been validated.",
    };
  }

  const knownSeries =
    is7304V
    || model.startsWith("HA7304C")
    || model.startsWith("HA7304VX")
    || model.startsWith("HA7304VXD")
    || model.startsWith("HA7304GJ")
    || model.startsWith("HA7004S")
    || model.startsWith("HA7104");
  if (knownSeries) {
    const gponNote = input.ponTechnology === "gpon"
      ? "GPON management writes are disabled because the supplied EPON materials do not prove GPON command compatibility."
      : "Enter the exact running firmware and use the validated EPON SNMP v2c profile before MIB discovery can be enabled.";
    return {
      status: "recognized-read-only",
      discoveryEnabled: false,
      provisioningEnabled: false,
      adapter: "none",
      message: `This HIOSO model is recognized but not validated for this hardware, firmware, protocol combination. ${gponNote}`,
    };
  }

  return {
    status: "unsupported",
    discoveryEnabled: false,
    provisioningEnabled: false,
    adapter: "none",
    message: "This HIOSO model is not in the compatibility registry. It remains read-only until its model, firmware, PON mode, and lab evidence are reviewed.",
  };
}