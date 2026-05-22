import { useState, useEffect, useCallback } from "react";
import { useGetSettings, useUpdateSettings } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Shield, Wifi, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle,
  Loader2, Download, RefreshCw, Trash2, Terminal, Copy, Check, Server, Lock,
  KeyRound, FileCode2, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

// ─── Types ────────────────────────────────────────────────────────────────────
interface VpnStatus {
  configured: boolean;
  certsGenerated: boolean;
  serverIp: string | null;
  vpnPort: number;
  vpnProtocol: string;
  vpnSubnet: string;
  vpnSubnetMask: string;
  vpnDns: string;
  certsGeneratedAt: string | null;
}

interface RouterCert {
  id: number;
  routerId: number;
  routerName: string;
  vpnIp: string | null;
  createdAt: string;
  revoked: boolean;
}

interface InfraStatus {
  radius: { configured: boolean; server: string | null };
  vpn: VpnStatus;
  routerCerts: RouterCert[];
  routerCount: number;
}

interface VpnForm {
  serverPublicIp: string;
  vpnPort: string;
  vpnProtocol: string;
  vpnSubnet: string;
  vpnSubnetMask: string;
  vpnDns: string;
}

// ─── Code block with copy ────────────────────────────────────────────────────
function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group">
      <pre className={`bg-gray-950 text-green-300 text-xs rounded-lg p-4 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap`}>
        {code}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-700 hover:bg-gray-600 text-white rounded px-2 py-1 text-xs flex items-center gap-1"
      >
        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
      </button>
    </div>
  );
}

// ─── Collapsible install guide ───────────────────────────────────────────────
function InstallGuide({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Terminal className="w-4 h-4 text-blue-500" /> {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-4 py-4 space-y-3 bg-white">{children}</div>}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">{n}</div>
      <div className="space-y-2 flex-1">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        {children}
      </div>
    </div>
  );
}

function SectionCard({ icon: Icon, title, badge, badgeVariant, children }: {
  icon: React.ElementType; title: string; badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline"; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 bg-gray-50 border-b border-gray-200">
        <Icon className="w-4 h-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-800 flex-1">{title}</h3>
        {badge && <Badge variant={badgeVariant ?? "secondary"} className="text-xs">{badge}</Badge>}
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-12 gap-3 items-start">
      <div className="col-span-4">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="col-span-8">{children}</div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────
export function InfrastructureTab({
  f, set,
}: {
  f: (k: string) => string;
  set: (k: string, v: string) => void;
}) {
  const [status, setStatus] = useState<InfraStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [vpnForm, setVpnForm] = useState<VpnForm>({
    serverPublicIp: "", vpnPort: "1194", vpnProtocol: "tcp",
    vpnSubnet: "10.8.0.0", vpnSubnetMask: "255.255.255.0", vpnDns: "8.8.8.8",
  });

  const [savingVpn, setSavingVpn] = useState(false);
  const [generatingCerts, setGeneratingCerts] = useState(false);
  const [testingRadius, setTestingRadius] = useState(false);
  const [exportingUsers, setExportingUsers] = useState(false);
  const [radiusResult, setRadiusResult] = useState<{ success: boolean; message: string } | null>(null);
  const [certMsg, setCertMsg] = useState("");
  const [generatingClientCert, setGeneratingClientCert] = useState<number | null>(null);
  const [clientCertMsg, setClientCertMsg] = useState<Record<number, string>>({});

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/infrastructure/status");
      const data = await res.json() as InfraStatus;
      setStatus(data);
      if (data.vpn) {
        setVpnForm({
          serverPublicIp: data.vpn.serverIp ?? "",
          vpnPort: String(data.vpn.vpnPort ?? 1194),
          vpnProtocol: data.vpn.vpnProtocol ?? "tcp",
          vpnSubnet: data.vpn.vpnSubnet ?? "10.8.0.0",
          vpnSubnetMask: data.vpn.vpnSubnetMask ?? "255.255.255.0",
          vpnDns: data.vpn.vpnDns ?? "8.8.8.8",
        });
      }
    } catch {
      // ignore
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const saveVpnConfig = async () => {
    setSavingVpn(true);
    try {
      await fetch("/api/infrastructure/vpn/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...vpnForm,
          vpnPort: Number(vpnForm.vpnPort),
        }),
      });
      await loadStatus();
    } finally {
      setSavingVpn(false);
    }
  };

  const generateCerts = async () => {
    setGeneratingCerts(true);
    setCertMsg("Generating certificates — this takes 20–40 seconds…");
    try {
      const res = await fetch("/api/infrastructure/vpn/generate-certs", { method: "POST" });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      setCertMsg(data.message ?? data.error ?? "Done");
      await loadStatus();
    } catch {
      setCertMsg("Certificate generation failed.");
    } finally {
      setGeneratingCerts(false);
    }
  };

  const testRadius = async () => {
    setTestingRadius(true);
    setRadiusResult(null);
    try {
      const res = await fetch("/api/infrastructure/radius/test", { method: "POST" });
      const data = await res.json() as { success: boolean; message: string };
      setRadiusResult(data);
    } catch {
      setRadiusResult({ success: false, message: "Request failed" });
    } finally {
      setTestingRadius(false);
    }
  };

  const exportUsers = async () => {
    setExportingUsers(true);
    try {
      const res = await fetch("/api/infrastructure/radius/export-users", { method: "POST" });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "netpulse-radius-users.sql";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportingUsers(false);
    }
  };

  const generateClientCertFn = async (routerId: number) => {
    setGeneratingClientCert(routerId);
    setClientCertMsg((prev) => ({ ...prev, [routerId]: "Generating…" }));
    try {
      const res = await fetch(`/api/infrastructure/vpn/client/${routerId}/generate`, { method: "POST" });
      const data = await res.json() as { success?: boolean; message?: string; error?: string; vpnIp?: string };
      setClientCertMsg((prev) => ({ ...prev, [routerId]: data.message ?? data.error ?? "Done" }));
      await loadStatus();
    } catch {
      setClientCertMsg((prev) => ({ ...prev, [routerId]: "Failed" }));
    } finally {
      setGeneratingClientCert(null);
    }
  };

  const downloadRosScript = (routerId: number) => {
    window.open(`/api/routers/${routerId}/ros-script`, "_blank");
  };

  const downloadServerConf = () => {
    window.open("/api/infrastructure/vpn/server-conf", "_blank");
  };

  const revokeClientCert = async (routerId: number) => {
    await fetch(`/api/infrastructure/vpn/client/${routerId}`, { method: "DELETE" });
    await loadStatus();
  };

  const vpnReady = status?.vpn?.certsGenerated;
  const serverVpnIp = vpnForm.vpnSubnet
    ? vpnForm.vpnSubnet.split(".").slice(0, 3).join(".") + ".1"
    : "10.8.0.1";

  return (
    <div className="space-y-5">
      {/* ── RADIUS SERVER ────────────────────────────────────────────────── */}
      <SectionCard
        icon={Shield}
        title="RADIUS Authentication"
        badge={status?.radius?.configured ? "Configured" : "Not Configured"}
        badgeVariant={status?.radius?.configured ? "default" : "secondary"}
      >
        <p className="text-xs text-gray-500 -mt-1">
          FreeRADIUS integration lets your MikroTik routers authenticate PPPoE subscribers
          against this app's user database. Routers query RADIUS over the VPN tunnel.
        </p>

        <div className="space-y-3">
          <Field label="RADIUS Server IP" hint="IP or hostname of your RADIUS server (usually this machine)">
            <Input
              value={f("radiusServer")}
              onChange={(e) => set("radiusServer", e.target.value)}
              placeholder="192.168.1.10 or 10.8.0.1"
              className="text-sm"
            />
          </Field>
          <Field label="Auth Port" hint="UDP port for authentication (default 1812)">
            <Input
              value={f("radiusPort") || "1812"}
              onChange={(e) => set("radiusPort", e.target.value)}
              placeholder="1812"
              className="text-sm"
            />
          </Field>
          <Field label="Acct Port" hint="UDP port for accounting (default 1813)">
            <Input
              value={f("radiusAcctPort") || "1813"}
              onChange={(e) => set("radiusAcctPort", e.target.value)}
              placeholder="1813"
              className="text-sm"
            />
          </Field>
          <Field label="Shared Secret" hint="Used in both Settings → Network and FreeRADIUS clients.conf">
            <Input
              type="password"
              value={f("radiusSecret")}
              onChange={(e) => set("radiusSecret", e.target.value)}
              placeholder="strong-shared-secret"
              className="text-sm"
            />
          </Field>
          <Field label="NAS Identifier" hint="Name used to identify this NetPulse server in RADIUS logs">
            <Input
              value={f("radiusNasId") || "netpulse"}
              onChange={(e) => set("radiusNasId", e.target.value)}
              placeholder="netpulse"
              className="text-sm"
            />
          </Field>
        </div>

        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={testRadius}
            disabled={testingRadius || !f("radiusServer")}
            className="gap-2"
          >
            {testingRadius ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Test Connection
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={exportUsers}
            disabled={exportingUsers}
            className="gap-2"
          >
            {exportingUsers ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export Users SQL
          </Button>

          {radiusResult && (
            <span className={`flex items-center gap-1.5 text-sm font-medium ${radiusResult.success ? "text-green-600" : "text-red-600"}`}>
              {radiusResult.success
                ? <CheckCircle2 className="w-4 h-4" />
                : <XCircle className="w-4 h-4" />}
              {radiusResult.message}
            </span>
          )}
        </div>

        <InstallGuide title="FreeRADIUS Install & Setup Guide (Ubuntu)">
          <Step n={1} title="Install FreeRADIUS with PostgreSQL backend">
            <CodeBlock code={`sudo apt update
sudo apt install -y freeradius freeradius-postgresql postgresql`} />
          </Step>
          <Step n={2} title="Import FreeRADIUS PostgreSQL schema">
            <CodeBlock code={`# Connect to postgres and create RADIUS database
sudo -u postgres psql -c "CREATE USER radius WITH PASSWORD 'radius-db-pass';"
sudo -u postgres psql -c "CREATE DATABASE radius OWNER radius;"

# Import the FreeRADIUS schema
sudo -u radius psql radius < /etc/freeradius/3.0/mods-config/sql/main/postgresql/schema.sql`} />
          </Step>
          <Step n={3} title="Configure FreeRADIUS SQL module">
            <CodeBlock code={`# Enable the SQL module
cd /etc/freeradius/3.0/mods-enabled
sudo ln -s ../mods-available/sql sql

# Edit /etc/freeradius/3.0/mods-available/sql
sudo nano /etc/freeradius/3.0/mods-available/sql`} />
            <CodeBlock lang="conf" code={`# Set these values in the sql section:
driver = "rlm_sql_postgresql"
dialect = "postgresql"
server = "localhost"
port = 5432
login = "radius"
password = "radius-db-pass"
radius_db = "radius"
read_clients = yes`} />
          </Step>
          <Step n={4} title="Register this NetPulse server as a NAS client">
            <p className="text-xs text-gray-600">Add to <code className="bg-gray-100 px-1 rounded">/etc/freeradius/3.0/clients.conf</code>:</p>
            <CodeBlock lang="conf" code={`client netpulse {
  ipaddr = 127.0.0.1
  secret = ${f("radiusSecret") || "your-secret-here"}
  shortname = netpulse
  nastype = other
}`} />
          </Step>
          <Step n={5} title="Import NetPulse subscribers into RADIUS DB">
            <p className="text-xs text-gray-600">Click <strong>Export Users SQL</strong> above, then run it against the radius database:</p>
            <CodeBlock code={`psql -U radius -d radius -f netpulse-radius-users.sql`} />
          </Step>
          <Step n={6} title="Start FreeRADIUS and test">
            <CodeBlock code={`sudo systemctl enable --now freeradius
sudo systemctl status freeradius

# Test authentication (install freeradius-utils first)
sudo apt install freeradius-utils
radtest testuser testpass localhost 0 ${f("radiusSecret") || "your-secret"}`} />
          </Step>
        </InstallGuide>
      </SectionCard>

      {/* ── OPENVPN SERVER ───────────────────────────────────────────────── */}
      <SectionCard
        icon={Lock}
        title="OpenVPN Server"
        badge={
          vpnReady
            ? "Certificates Ready"
            : status?.vpn?.configured
            ? "Configured — No Certs"
            : "Not Configured"
        }
        badgeVariant={vpnReady ? "default" : "secondary"}
      >
        <p className="text-xs text-gray-500 -mt-1">
          An OpenVPN server on this machine creates secure tunnels to each MikroTik router.
          RADIUS authentication travels over these tunnels, keeping your network private.
        </p>

        {status?.vpn?.certsGeneratedAt && (
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Certificates generated {new Date(status!.vpn!.certsGeneratedAt!).toLocaleDateString()}
          </div>
        )}

        {/* VPN Config form */}
        <div className="space-y-3">
          <Field label="Server Public IP / Domain" hint="Public IP or domain that routers will connect to">
            <Input
              value={vpnForm.serverPublicIp}
              onChange={(e) => setVpnForm((v) => ({ ...v, serverPublicIp: e.target.value }))}
              placeholder="203.0.113.10 or vpn.myisp.co.ke"
              className="text-sm"
            />
          </Field>
          <Field label="VPN Port" hint="OpenVPN listen port (default 1194)">
            <Input
              value={vpnForm.vpnPort}
              onChange={(e) => setVpnForm((v) => ({ ...v, vpnPort: e.target.value }))}
              placeholder="1194"
              className="text-sm"
            />
          </Field>
          <Field label="Protocol" hint="TCP is more reliable through NAT; UDP is faster">
            <div className="flex gap-2">
              {["tcp", "udp"].map((p) => (
                <button
                  key={p}
                  onClick={() => setVpnForm((v) => ({ ...v, vpnProtocol: p }))}
                  className={`flex-1 py-1.5 rounded text-sm font-medium border transition-colors ${
                    vpnForm.vpnProtocol === p
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-700 border-gray-300 hover:border-blue-400"
                  }`}
                >
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>
          <Field label="VPN Subnet" hint="Private subnet assigned to VPN clients (e.g. 10.8.0.0)">
            <Input
              value={vpnForm.vpnSubnet}
              onChange={(e) => setVpnForm((v) => ({ ...v, vpnSubnet: e.target.value }))}
              placeholder="10.8.0.0"
              className="text-sm"
            />
          </Field>
          <Field label="Subnet Mask" hint="Mask for VPN subnet">
            <Input
              value={vpnForm.vpnSubnetMask}
              onChange={(e) => setVpnForm((v) => ({ ...v, vpnSubnetMask: e.target.value }))}
              placeholder="255.255.255.0"
              className="text-sm"
            />
          </Field>
          <Field label="DNS for VPN Clients" hint="DNS pushed to router VPN clients">
            <Input
              value={vpnForm.vpnDns}
              onChange={(e) => setVpnForm((v) => ({ ...v, vpnDns: e.target.value }))}
              placeholder="8.8.8.8"
              className="text-sm"
            />
          </Field>
        </div>

        <div className="flex flex-wrap gap-3 pt-1">
          <Button
            size="sm"
            onClick={saveVpnConfig}
            disabled={savingVpn || !vpnForm.serverPublicIp}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
          >
            {savingVpn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Server className="w-3.5 h-3.5" />}
            Save VPN Config
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={generateCerts}
            disabled={generatingCerts || !status?.vpn?.configured}
            className="gap-2"
          >
            {generatingCerts ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            {vpnReady ? "Regenerate Certs" : "Generate Certificates"}
          </Button>

          {vpnReady && (
            <Button size="sm" variant="outline" onClick={downloadServerConf} className="gap-2">
              <Download className="w-3.5 h-3.5" /> Download server.conf
            </Button>
          )}
        </div>

        {certMsg && (
          <p className={`text-sm flex items-center gap-1.5 ${certMsg.toLowerCase().includes("fail") ? "text-red-600" : "text-blue-700"}`}>
            {generatingCerts
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : certMsg.toLowerCase().includes("fail")
              ? <XCircle className="w-3.5 h-3.5" />
              : <CheckCircle2 className="w-3.5 h-3.5" />}
            {certMsg}
          </p>
        )}

        <InstallGuide title="OpenVPN Server Install Guide (Ubuntu)">
          <Step n={1} title="Install OpenVPN">
            <CodeBlock code={`sudo apt update && sudo apt install -y openvpn
sudo mkdir -p /etc/openvpn/server /var/log/openvpn`} />
          </Step>
          <Step n={2} title="Download the generated server config">
            <p className="text-xs text-gray-600">
              Click <strong>Download server.conf</strong> above. The file includes embedded
              CA + server certificates — no separate .pem files needed.
            </p>
            <CodeBlock code={`# Copy the file to your server
scp netpulse-vpn-server.conf root@YOUR_SERVER:/etc/openvpn/server/netpulse.conf`} />
          </Step>
          <Step n={3} title="Enable IP forwarding">
            <CodeBlock code={`echo "net.ipv4.ip_forward = 1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p`} />
          </Step>
          <Step n={4} title="Start OpenVPN and enable on boot">
            <CodeBlock code={`sudo systemctl enable --now openvpn-server@netpulse
sudo systemctl status openvpn-server@netpulse

# Watch live connection log
sudo tail -f /var/log/openvpn/server.log`} />
          </Step>
          <Step n={5} title="Open firewall port">
            <CodeBlock code={`# Allow VPN port (adjust if not using default 1194/tcp)
sudo ufw allow ${vpnForm.vpnPort}/${vpnForm.vpnProtocol}
sudo ufw allow from ${vpnForm.vpnSubnet}/24  # Allow VPN subnet traffic`} />
          </Step>
          <Step n={6} title="IP masquerade (so routers reach the RADIUS server)">
            <CodeBlock code={`# Find your main network interface
ip route get 1 | awk '{print $5; exit}'

# Add masquerade rule (replace eth0 with your interface)
sudo iptables -t nat -A POSTROUTING -s ${vpnForm.vpnSubnet}/24 -o eth0 -j MASQUERADE
sudo apt install iptables-persistent
sudo netfilter-persistent save`} />
          </Step>
        </InstallGuide>
      </SectionCard>

      {/* ── MIKROTIK ROUTER VPN INTEGRATION ──────────────────────────────── */}
      <SectionCard
        icon={Cpu}
        title="MikroTik Router VPN Certificates"
        badge={`${status?.routerCerts.filter((c) => !c.revoked).length ?? 0} / ${status?.routerCount ?? 0} routers`}
        badgeVariant="outline"
      >
        <p className="text-xs text-gray-500 -mt-1">
          Generate a unique client certificate for each MikroTik router. Then download the
          <code className="bg-gray-100 px-1 rounded mx-0.5">.rsc</code>
          script — run it on the router to configure the VPN tunnel and RADIUS auth automatically.
        </p>

        {!vpnReady && (
          <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Generate VPN certificates in the <strong>OpenVPN Server</strong> section above before creating router configs.</span>
          </div>
        )}

        {loadingStatus ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading router list…
          </div>
        ) : status && status.routerCount > 0 ? (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">Router</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">VPN IP</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">Cert Status</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* Merge router list from status */}
                {Array.from({ length: status.routerCount }, (_, i) => {
                  const cert = status.routerCerts.find((c) => !c.revoked && i === status.routerCerts.indexOf(c));
                  return null;
                })}
                {/* Use routerCerts which includes routerName */}
                {status.routerCerts.length === 0
                  ? null
                  : status.routerCerts.map((cert) => (
                    <tr key={cert.routerId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{cert.routerName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">{cert.vpnIp ?? "—"}</td>
                      <td className="px-4 py-3">
                        {cert.revoked
                          ? <Badge variant="destructive" className="text-xs">Revoked</Badge>
                          : <Badge variant="default" className="text-xs bg-green-600">Active</Badge>}
                        {clientCertMsg[cert.routerId] && (
                          <p className="text-xs text-blue-600 mt-0.5">{clientCertMsg[cert.routerId]}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {(!cert.revoked) && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 gap-1.5 text-xs"
                              onClick={() => downloadRosScript(cert.routerId)}
                            >
                              <FileCode2 className="w-3 h-3" /> .rsc
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 gap-1.5 text-xs"
                            disabled={generatingClientCert === cert.routerId || !vpnReady}
                            onClick={() => generateClientCertFn(cert.routerId)}
                          >
                            {generatingClientCert === cert.routerId
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <RefreshCw className="w-3 h-3" />}
                            Regen
                          </Button>
                          {!cert.revoked && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => revokeClientCert(cert.routerId)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* Routers without certs */}
        <RoutersWithoutCerts
          status={status}
          vpnReady={vpnReady ?? false}
          generatingClientCert={generatingClientCert}
          clientCertMsg={clientCertMsg}
          onGenerate={generateClientCertFn}
          onRefresh={loadStatus}
        />

        <InstallGuide title="How to apply the .rsc script on MikroTik">
          <Step n={1} title="Download the .rsc file">
            <p className="text-xs text-gray-600">
              Click the <strong>.rsc</strong> button next to your router to download a RouterOS script
              that's pre-filled with this router's certificates and your server details.
            </p>
          </Step>
          <Step n={2} title="Upload to the router">
            <CodeBlock code={`# Option A — Winbox
# Open Files panel → drag the .rsc file onto it

# Option B — SCP
scp netpulse-vpn-ROUTERNAME.rsc admin@ROUTER_IP:

# Option C — FTP
ftp ROUTER_IP  # then put the file`} />
          </Step>
          <Step n={3} title="Run the import script">
            <CodeBlock code={`# In RouterOS Terminal (Winbox or SSH):
/import file-name=netpulse-vpn-ROUTERNAME.rsc

# Script runs in ~30 seconds and configures:
# • OpenVPN client tunnel → your server
# • RADIUS auth for PPPoE over the VPN
# • Static route to reach NetPulse server`} />
          </Step>
          <Step n={4} title="Verify the tunnel">
            <CodeBlock code={`# Check VPN tunnel status
/interface ovpn-client print

# Check RADIUS config
/radius print

# Check VPN route
/ip route print where comment="netpulse-radius-route"

# Test RADIUS reachability
/radius test username=testuser password=testpass`} />
          </Step>
        </InstallGuide>
      </SectionCard>
    </div>
  );
}

// ─── Routers without certs table ─────────────────────────────────────────────
function RoutersWithoutCerts({
  status, vpnReady, generatingClientCert, clientCertMsg, onGenerate, onRefresh,
}: {
  status: InfraStatus | null;
  vpnReady: boolean;
  generatingClientCert: number | null;
  clientCertMsg: Record<number, string>;
  onGenerate: (id: number) => void;
  onRefresh: () => void;
}) {
  const [routers, setRouters] = useState<Array<{ id: number; name: string; routerType: string }>>([]);

  useEffect(() => {
    fetch("/api/routers")
      .then((r) => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setRouters(data as Array<{ id: number; name: string; routerType: string }>);
        }
      })
      .catch(() => {});
  }, [status]);

  const certRouterIds = new Set((status?.routerCerts ?? []).filter((c) => !c.revoked).map((c) => c.routerId));
  const withoutCert = routers.filter((r) => !certRouterIds.has(r.id));

  if (withoutCert.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Routers without VPN certificate ({withoutCert.length})
      </p>
      <div className="border border-dashed border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            {withoutCert.map((r) => (
              <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-800">{r.name}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">No certificate</td>
                <td className="px-4 py-3">
                  {clientCertMsg[r.id] && (
                    <p className="text-xs text-blue-600">{clientCertMsg[r.id]}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 gap-1.5 text-xs"
                    disabled={generatingClientCert === r.id || !vpnReady}
                    onClick={() => onGenerate(r.id)}
                  >
                    {generatingClientCert === r.id
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <KeyRound className="w-3 h-3" />}
                    Generate Cert
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
