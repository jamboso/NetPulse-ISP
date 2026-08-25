import net from "node:net";

type RouterManagementRecord = {
  routerType: string;
  ipAddress: string;
  vpnIp?: string | null;
  vpnConnected?: boolean | null;
};

/**
 * RouterOS devices created through zero-touch provisioning are administered
 * exclusively through their private OpenVPN address. The stored ipAddress is
 * retained only for legacy devices and non-RouterOS integrations.
 */
export function getRouterManagementHost(router: RouterManagementRecord): string | null {
  if (router.routerType !== "routeros") {
    return router.ipAddress.trim() || null;
  }

  // Retain access for pre-zero-touch RouterOS records that predate the VPN
  // columns. Every current record has these fields and must use the tunnel.
  if (router.vpnIp === undefined && router.vpnConnected === undefined) {
    return router.ipAddress.trim() || null;
  }

  const vpnIp = router.vpnIp?.trim();
  if (!router.vpnConnected || !vpnIp || net.isIP(vpnIp) !== 4) {
    return null;
  }

  return vpnIp;
}

export function routerManagementUnavailableMessage(): string {
  return "Router management is available after its private NetPulse VPN tunnel connects. Run the zero-touch provisioning command first.";
}