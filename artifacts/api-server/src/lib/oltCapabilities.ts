import type { OltAdapterInput } from "./oltAdapters";

export type OltCapability = {
  status: "mib-validated-read-only" | "standard-identity-read-only" | "recognized-read-only" | "unsupported";
  discoveryEnabled: boolean;
  provisioningEnabled: false;
  adapter: "hioso-epon-mib" | "hioso-gpon-identity" | "vendor-standard-snmp-identity" | "none";
  message: string;
};

export type OltCompatibilityProfile = {
  vendor: string;
  models: string[];
  ponTechnologies: Array<"epon" | "gpon">;
  ponPortCapacity: string;
  firmwareRequirement: string;
  managementRequirement: string;
  status: "recognized-read-only";
  message: string;
};

function normalized(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

const compatibilityProfiles: OltCompatibilityProfile[] = [
  {
    vendor: "Huawei",
    models: ["MA5608T"],
    ponTechnologies: ["epon", "gpon"],
    ponPortCapacity: "Up to 32 PON ports, depending on installed service boards",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized small-ISP chassis profile. No Huawei inventory or provisioning command is enabled.",
  },
  {
    vendor: "Huawei",
    models: ["MA5801"],
    ponTechnologies: ["gpon"],
    ponPortCapacity: "8 or 16 built-in GPON ports",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized fixed GPON profile. No Huawei inventory or provisioning command is enabled.",
  },
  {
    vendor: "Huawei",
    models: ["MA5683T"],
    ponTechnologies: ["epon", "gpon"],
    ponPortCapacity: "Up to 80 PON ports, depending on installed service boards",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized modular chassis profile. No Huawei inventory or provisioning command is enabled.",
  },
  {
    vendor: "Huawei",
    models: ["MA5800-X2", "MA5800-X7", "MA5800-X15"],
    ponTechnologies: ["gpon"],
    ponPortCapacity: "4–16 PON ports per service board; chassis capacity depends on installed boards",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized MA5800 family profile. No Huawei inventory or provisioning command is enabled.",
  },
  {
    vendor: "V-SOL",
    models: ["V1600D1"],
    ponTechnologies: ["epon"],
    ponPortCapacity: "1 EPON port · up to 64 ONUs",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized 1-port EPON profile. No V-SOL inventory or provisioning command is enabled.",
  },
  {
    vendor: "V-SOL",
    models: ["V1600G1"],
    ponTechnologies: ["gpon"],
    ponPortCapacity: "1 GPON port · up to 128 ONUs",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized 1-port GPON profile. No V-SOL inventory or provisioning command is enabled.",
  },
  {
    vendor: "V-SOL",
    models: ["V1600D2"],
    ponTechnologies: ["epon"],
    ponPortCapacity: "2 EPON ports · up to 128 ONUs",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized 2-port EPON profile. No V-SOL inventory or provisioning command is enabled.",
  },
  {
    vendor: "V-SOL",
    models: ["V1600G2-B"],
    ponTechnologies: ["gpon"],
    ponPortCapacity: "2 GPON ports · up to 256 ONUs · 10G uplinks",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized 2-port GPON profile. No V-SOL inventory or provisioning command is enabled.",
  },
  {
    vendor: "V-SOL",
    models: ["V1600D4-DP"],
    ponTechnologies: ["epon"],
    ponPortCapacity: "4 EPON ports · up to 256 ONUs · dual power supplies",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized 4-port EPON profile. No V-SOL inventory or provisioning command is enabled.",
  },
  {
    vendor: "V-SOL",
    models: ["V1600G4-DP"],
    ponTechnologies: ["gpon"],
    ponPortCapacity: "4 GPON ports · up to 512 ONUs · 10G uplinks and dual power",
    firmwareRequirement: "Exact running firmware has not been provided; lab validation is required.",
    managementRequirement: "Provide the enabled management interface and redacted MIB, API, or CLI evidence.",
    status: "recognized-read-only",
    message: "Recognized 4-port GPON profile. No V-SOL inventory or provisioning command is enabled.",
  },
];

export function getOltCompatibilityMatrix(): OltCompatibilityProfile[] {
  return compatibilityProfiles.map((profile) => ({ ...profile, models: [...profile.models], ponTechnologies: [...profile.ponTechnologies] }));
}

function matchingKnownProfile(input: Pick<OltAdapterInput, "vendor" | "model" | "ponTechnology">): OltCompatibilityProfile | undefined {
  const vendor = normalized(input.vendor);
  const model = normalized(input.model);
  return compatibilityProfiles.find((profile) =>
    normalized(profile.vendor) === vendor
    && profile.models.some((candidate) => normalized(candidate) === model)
    && profile.ponTechnologies.includes(input.ponTechnology as "epon" | "gpon"),
  );
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
  const knownProfile = matchingKnownProfile(input);
  if (knownProfile) {
    const standardIdentityEnabled = input.managementProtocol === "snmp-v2c";
    return {
      status: standardIdentityEnabled ? "standard-identity-read-only" : "recognized-read-only",
      discoveryEnabled: standardIdentityEnabled,
      provisioningEnabled: false,
      adapter: standardIdentityEnabled ? "vendor-standard-snmp-identity" : "none",
      message: standardIdentityEnabled
        ? `Standard SNMP system identity discovery is enabled for this exact model. Vendor PON/ONU inventory and provisioning remain disabled. Capacity: ${knownProfile.ponPortCapacity} ${knownProfile.firmwareRequirement}`
        : `${knownProfile.message} Use SNMP v2c only to enable standard system identity verification. Capacity: ${knownProfile.ponPortCapacity} ${knownProfile.firmwareRequirement}`,
    };
  }

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