import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateOpenVpnServerConf } from "../lib/certGen.js";

const repoFile = (path: string) => resolve(process.cwd(), "../..", path);

describe("RouterOS VPN deployment safety", () => {
  it("scopes repair to the marked NetPulse OpenVPN instance", async () => {
    const helper = await readFile(repoFile("deploy/repair-openvpn.sh"), "utf8");

    expect(helper).toContain('UNIT="openvpn-server@netpulse"');
    expect(helper).toContain('CONFIG="/etc/openvpn/server/netpulse.conf"');
    expect(helper).toContain('MARKER="# Managed by NetPulse: RouterOS management VPN"');
    expect(helper).toContain('grep -Fxq "$MARKER" "$CONFIG"');
    expect(helper).toContain('PORT="$(awk');
    expect(helper).toContain('[[ "$PROTOCOL" != "tcp" && "$PROTOCOL" != "tcp-server" ]]');
    expect(helper).not.toContain('openvpn@server');
    expect(helper).not.toContain('/etc/openvpn/server.conf');
  });

  it("keeps NetPulse configuration isolated from generic OpenVPN installs", async () => {
    const [installer, setup, enable] = await Promise.all([
      readFile(repoFile("install.sh"), "utf8"),
      readFile(repoFile("deploy/setup-ubuntu.sh"), "utf8"),
      readFile(repoFile("deploy/enable-vpn.sh"), "utf8"),
    ]);

    for (const script of [installer, setup, enable]) {
      expect(script).toContain("openvpn-server@netpulse");
      expect(script).toContain("# Managed by NetPulse: RouterOS management VPN");
      expect(script).not.toContain("openvpn@server");
      expect(script).not.toContain("/etc/openvpn/server.conf");
    }
  });

  it("requires explicit operator confirmation before migrating a legacy generic service", async () => {
    const migration = await readFile(repoFile("deploy/migrate-legacy-routeros-vpn.sh"), "utf8");

    expect(migration).toContain("--confirm-legacy-netpulse-vpn");
    expect(migration).toContain("Do not run it for Tabana-VPN");
    expect(migration).toContain("systemctl start \"$LEGACY_UNIT\" 2>/dev/null || true");
    expect(migration).toContain("systemctl disable \"$NETPULSE_UNIT\" --quiet");
    expect(migration).toContain('rm -rf "$NETPULSE_DIR" "$NETPULSE_EASYRSA"');
  });

  it("refreshes the fixed root helper through every upgrade path", async () => {
    const [safeUpdater, legacyInstaller, ubuntuSetup] = await Promise.all([
      readFile(repoFile("deploy/update.sh"), "utf8"),
      readFile(repoFile("install.sh"), "utf8"),
      readFile(repoFile("deploy/setup-ubuntu.sh"), "utf8"),
    ]);

    for (const script of [safeUpdater, legacyInstaller, ubuntuSetup]) {
      expect(script).toContain("/usr/local/bin/netpulse-vpn-repair");
      expect(script).toContain("/usr/local/bin/netpulse-vpn-read-certificates");
      expect(script).toContain("visudo -cf /etc/sudoers.d/netpulse-vpn");
    }
    expect(safeUpdater).toContain('Deployment scripts are not root-owned; refusing to install a privileged helper.');
    expect(legacyInstaller).toContain("NetPulse deployment scripts must be root-owned before installing a privileged helper.");
  });

  it("generates split-tunnel server configuration without default-route or DNS pushes", () => {
    const config = generateOpenVpnServerConf({
      port: 443,
      protocol: "tcp",
      subnet: "10.8.0.0",
      subnetMask: "255.255.255.0",
      dns: "1.1.1.1",
      caCert: "CA",
      serverCert: "SERVER_CERT",
      serverKey: "SERVER_KEY",
    });

    expect(config).toContain("# Managed by NetPulse: RouterOS management VPN");
    expect(config).toContain("port 443");
    expect(config).toContain("proto tcp-server");
    expect(config).toContain("writepid /run/openvpn/netpulse-routeros.pid");
    expect(config).not.toMatch(/redirect-gateway|dhcp-option\s+DNS|push\s+"route/i);
  });
});