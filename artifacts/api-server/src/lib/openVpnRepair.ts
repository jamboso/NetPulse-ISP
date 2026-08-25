import { execFile } from "node:child_process";

export type OpenVpnRepairState = "healthy" | "repaired" | "blocked" | "failed" | "unavailable";

export type OpenVpnRepairResult = {
  success: boolean;
  state: OpenVpnRepairState;
  message: string;
  events: string[];
};

const REPAIR_HELPER = "/usr/local/bin/netpulse-vpn-repair";
const TIMEOUT_MS = 35_000;

function parseRepairResult(output: string): OpenVpnRepairResult | null {
  try {
    const parsed = JSON.parse(output.trim()) as Partial<OpenVpnRepairResult>;
    if (
      typeof parsed.success === "boolean"
      && typeof parsed.state === "string"
      && typeof parsed.message === "string"
      && Array.isArray(parsed.events)
      && parsed.events.every((event) => typeof event === "string")
    ) {
      return parsed as OpenVpnRepairResult;
    }
  } catch {
    // The caller receives a safe failure below when the root helper cannot return JSON.
  }
  return null;
}

export function repairOpenVpnService(): Promise<OpenVpnRepairResult> {
  return new Promise((resolve) => {
    execFile(
      "sudo",
      ["-n", REPAIR_HELPER, "--json"],
      { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        const result = parseRepairResult(String(stdout));
        if (result) {
          resolve(result);
          return;
        }

        const detail = String(stderr).trim();
        const unavailable = error && (
          (error as NodeJS.ErrnoException).code === "ENOENT"
          || detail.includes("not found")
          || detail.includes("not allowed to run sudo")
        );
        resolve({
          success: false,
          state: unavailable ? "unavailable" : "failed",
          message: unavailable
            ? "The NetPulse VPN repair helper is not installed or not authorized on this server."
            : "The NetPulse VPN repair helper did not return a valid status.",
          events: detail ? [detail.slice(0, 1000)] : [],
        });
      },
    );
  });
}