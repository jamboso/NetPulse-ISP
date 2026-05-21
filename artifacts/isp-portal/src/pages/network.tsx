import { useState, useEffect } from "react";
import { useMacVendor } from "@/hooks/useMacVendor";
import {
  useListEquipment, useCreateEquipment, useUpdateEquipment, useDeleteEquipment,
  useListIpPools, useCreateIpPool, useUpdateIpPool, useDeleteIpPool,
  useListRouters, useCreateRouter, useUpdateRouter, useDeleteRouter,
  RouterDeviceInputRouterType, RouterDeviceUpdateRouterType,
  EquipmentInput, EquipmentUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Plus, Server, Route, Wifi, Pencil, Trash2, ChevronDown,
  CheckCircle2, Circle, WrenchIcon, AlertTriangle, LayoutDashboard, FileCode2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

// ─── Types ────────────────────────────────────────────────────────────────────
type RouterFormData = {
  name: string; routerType: string; ipAddress: string; port: string;
  username: string; password: string; description: string; location: string;
  apiSsl: boolean; sshPort: string; netconfPort: string; enabled: boolean;
};

type EquipmentFormData = {
  name: string; type: string; model: string; brand: string; ipAddress: string;
  macAddress: string; location: string; status: string; notes: string;
};

type IpPoolFormData = {
  name: string; network: string; gateway: string; subnetMask: string;
  dns1: string; dns2: string; description: string;
};

const ROUTER_DEFAULTS: RouterFormData = {
  name: "", routerType: "routeros", ipAddress: "", port: "",
  username: "admin", password: "", description: "", location: "",
  apiSsl: false, sshPort: "", netconfPort: "", enabled: true,
};

const EQUIPMENT_DEFAULTS: EquipmentFormData = {
  name: "", type: "router", model: "", brand: "", ipAddress: "",
  macAddress: "", location: "", status: "online", notes: "",
};

const POOL_DEFAULTS: IpPoolFormData = {
  name: "", network: "", gateway: "", subnetMask: "255.255.255.0",
  dns1: "8.8.8.8", dns2: "8.8.4.4", description: "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function routerTypeLabel(t: string) {
  return { routeros: "RouterOS", juniper: "JunOS", edgerouter: "EdgeRouter" }[t] ?? t;
}

function routerTypeBadgeClass(t: string) {
  return {
    routeros: "bg-blue-50 text-blue-700 border-blue-200",
    juniper:  "bg-orange-50 text-orange-700 border-orange-200",
    edgerouter: "bg-purple-50 text-purple-700 border-purple-200",
  }[t] ?? "bg-gray-100 text-gray-600";
}

function statusDot(status: string) {
  if (status === "online")      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (status === "offline")     return <Circle className="w-4 h-4 text-red-400" />;
  if (status === "maintenance") return <WrenchIcon className="w-4 h-4 text-orange-400" />;
  return <AlertTriangle className="w-4 h-4 text-gray-400" />;
}

// ─── Router Dialog ────────────────────────────────────────────────────────────
function RouterDialog({
  open, onClose, initial, routerId,
}: {
  open: boolean;
  onClose: () => void;
  initial?: RouterFormData;
  routerId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateRouter();
  const updateMutation = useUpdateRouter();
  const [form, setForm] = useState<RouterFormData>(initial ?? ROUTER_DEFAULTS);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof RouterFormData, v: string | boolean) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const basePayload = {
        name: form.name,
        ipAddress: form.ipAddress,
        port: form.port ? parseInt(form.port) : undefined,
        username: form.username,
        password: form.password,
        description: form.description || undefined,
        location: form.location || undefined,
        apiSsl: form.apiSsl,
        sshPort: form.sshPort ? parseInt(form.sshPort) : undefined,
        netconfPort: form.netconfPort ? parseInt(form.netconfPort) : undefined,
        enabled: form.enabled,
      };
      if (routerId) {
        await updateMutation.mutateAsync({
          id: routerId,
          data: { ...basePayload, routerType: form.routerType as RouterDeviceUpdateRouterType },
        });
      } else {
        await createMutation.mutateAsync({
          data: { ...basePayload, routerType: form.routerType as RouterDeviceInputRouterType },
        });
      }
      await qc.invalidateQueries({ queryKey: ["/api/routers"] });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{routerId ? "Edit Router" : "Add Router"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name / Location *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Core-Router-01" />
            </div>
            <div className="space-y-1">
              <Label>Router Type *</Label>
              <Select value={form.routerType} onValueChange={(v) => set("routerType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="routeros">MikroTik RouterOS</SelectItem>
                  <SelectItem value="juniper">Juniper JunOS</SelectItem>
                  <SelectItem value="edgerouter">Ubiquiti EdgeRouter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>IP Address *</Label>
              <Input value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)}
                placeholder={form.routerType === "routeros" ? "192.168.88.1" : "192.168.1.1"} />
            </div>
            <div className="space-y-1">
              <Label>
                {form.routerType === "routeros" ? "API Port" : "SSH Port"}
              </Label>
              <Input
                type="number"
                value={form.routerType === "routeros" ? form.port : form.sshPort}
                onChange={(e) =>
                  form.routerType === "routeros"
                    ? set("port", e.target.value)
                    : set("sshPort", e.target.value)
                }
                placeholder={form.routerType === "routeros" ? "8728" : "22"}
              />
            </div>
          </div>

          {form.routerType === "juniper" && (
            <div className="space-y-1">
              <Label>NETCONF Port</Label>
              <Input type="number" value={form.netconfPort} onChange={(e) => set("netconfPort", e.target.value)} placeholder="830" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Username *</Label>
              <Input value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="admin" />
            </div>
            <div className="space-y-1">
              <Label>Password *</Label>
              <Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••" />
            </div>
          </div>

          {form.routerType === "routeros" && (
            <div className="flex items-center gap-3">
              <Switch checked={form.apiSsl} onCheckedChange={(v) => set("apiSsl", v)} id="apiSsl" />
              <Label htmlFor="apiSsl" className="text-sm cursor-pointer">Use SSL/TLS for API connection (port 8729)</Label>
            </div>
          )}

          <div className="space-y-1">
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Data Centre, Rack 3" />
          </div>

          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className="resize-none" placeholder="Core BGP router serving Zone A" />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} id="enabled" />
            <Label htmlFor="enabled" className="text-sm cursor-pointer">Enabled (monitored by system)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.ipAddress || !form.username}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : routerId ? "Update" : "Add Router"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Equipment Dialog ────────────────────────────────────────────────────────
function EquipmentDialog({
  open, onClose, initial, equipmentId,
}: {
  open: boolean; onClose: () => void; initial?: EquipmentFormData; equipmentId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateEquipment();
  const updateMutation = useUpdateEquipment();
  const [form, setForm] = useState<EquipmentFormData>(initial ?? EQUIPMENT_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [brandAutoFilled, setBrandAutoFilled] = useState(false);

  const set = (k: keyof EquipmentFormData, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const { vendor: detectedVendor, loading: vendorLoading } = useMacVendor(form.macAddress);

  useEffect(() => {
    if (detectedVendor && !form.brand) {
      set("brand", detectedVendor);
      setBrandAutoFilled(true);
    }
  }, [detectedVendor]);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (equipmentId) {
        await updateMutation.mutateAsync({
          id: equipmentId,
          data: {
            name: form.name, model: form.model, ipAddress: form.ipAddress,
            brand: form.brand || null, macAddress: form.macAddress || null,
            location: form.location || null, notes: form.notes || null,
          } as EquipmentUpdate,
        });
      } else {
        await createMutation.mutateAsync({
          data: {
            name: form.name, type: form.type, model: form.model, ipAddress: form.ipAddress,
            brand: form.brand || undefined, macAddress: form.macAddress || undefined,
            location: form.location || undefined, status: form.status || undefined,
            notes: form.notes || undefined,
          } as EquipmentInput,
        });
      }
      await qc.invalidateQueries({ queryKey: ["/api/equipment"] });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{equipmentId ? "Edit Equipment" : "Add Equipment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Core Switch 01" />
            </div>
            <div className="space-y-1">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["router","switch","olt","onu","access_point","server","other"].map((t) => (
                    <SelectItem key={t} value={t}>{t.replace("_"," ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5">
                Brand
                {vendorLoading && (
                  <span className="text-[10px] text-blue-500 animate-pulse">looking up…</span>
                )}
                {brandAutoFilled && !vendorLoading && (
                  <span className="text-[10px] text-green-600 bg-green-50 border border-green-200 rounded px-1">auto-detected</span>
                )}
              </Label>
              <Input
                value={form.brand}
                onChange={(e) => { set("brand", e.target.value); setBrandAutoFilled(false); }}
                placeholder={vendorLoading ? "Detecting…" : "Cisco"}
              />
            </div>
            <div className="space-y-1">
              <Label>Model *</Label>
              <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="Catalyst 2960" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>IP Address *</Label>
              <Input value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)} placeholder="10.0.0.1" />
            </div>
            <div className="space-y-1">
              <Label>MAC Address</Label>
              <Input
                value={form.macAddress}
                onChange={(e) => { set("macAddress", e.target.value); setBrandAutoFilled(false); }}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
              {detectedVendor && (
                <p className="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                  {detectedVendor}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Location</Label>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Rack 2, DC Floor 1" />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.ipAddress || !form.model}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : equipmentId ? "Update" : "Add Equipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── IP Pool Dialog ───────────────────────────────────────────────────────────
function IpPoolDialog({
  open, onClose, initial, poolId,
}: {
  open: boolean; onClose: () => void; initial?: IpPoolFormData; poolId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateIpPool();
  const updateMutation = useUpdateIpPool();
  const [form, setForm] = useState<IpPoolFormData>(initial ?? POOL_DEFAULTS);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof IpPoolFormData, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name, network: form.network, gateway: form.gateway,
        subnetMask: form.subnetMask, dns1: form.dns1 || undefined,
        dns2: form.dns2 || undefined, description: form.description || undefined,
      };
      if (poolId) {
        await updateMutation.mutateAsync({ id: poolId, data: payload });
      } else {
        await createMutation.mutateAsync({ data: payload });
      }
      await qc.invalidateQueries({ queryKey: ["/api/ip-pools"] });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{poolId ? "Edit IP Pool" : "Add IP Pool"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Pool Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Customer Pool A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Network (CIDR) *</Label>
              <Input value={form.network} onChange={(e) => set("network", e.target.value)} placeholder="192.168.1.0/24" />
            </div>
            <div className="space-y-1">
              <Label>Gateway *</Label>
              <Input value={form.gateway} onChange={(e) => set("gateway", e.target.value)} placeholder="192.168.1.1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Subnet Mask *</Label>
              <Input value={form.subnetMask} onChange={(e) => set("subnetMask", e.target.value)} placeholder="255.255.255.0" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Primary DNS</Label>
              <Input value={form.dns1} onChange={(e) => set("dns1", e.target.value)} placeholder="8.8.8.8" />
            </div>
            <div className="space-y-1">
              <Label>Secondary DNS</Label>
              <Input value={form.dns2} onChange={(e) => set("dns2", e.target.value)} placeholder="8.8.4.4" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} className="resize-none" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.network || !form.gateway}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : poolId ? "Update" : "Add Pool"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Network() {
  const { data: equipmentData, isLoading: loadingEquipment } = useListEquipment();
  const { data: ipPoolsData, isLoading: loadingIpPools } = useListIpPools();
  const { data: routersData, isLoading: loadingRouters } = useListRouters();

  const deleteEquipment = useDeleteEquipment();
  const deletePool = useDeleteIpPool();
  const deleteRouter = useDeleteRouter();
  const qc = useQueryClient();

  // Router dialog
  const [routerDialog, setRouterDialog] = useState<{ open: boolean; id?: number; initial?: RouterFormData }>({ open: false });
  // Equipment dialog
  const [equipDialog, setEquipDialog] = useState<{ open: boolean; id?: number; initial?: EquipmentFormData }>({ open: false });
  // IP Pool dialog
  const [poolDialog, setPoolDialog] = useState<{ open: boolean; id?: number; initial?: IpPoolFormData }>({ open: false });

  const handleDeleteRouter = async (id: number) => {
    if (!confirm("Delete this router?")) return;
    await deleteRouter.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/routers"] });
  };

  const handleDeleteEquipment = async (id: number) => {
    if (!confirm("Delete this equipment?")) return;
    await deleteEquipment.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/equipment"] });
  };

  const handleDeletePool = async (id: number) => {
    if (!confirm("Delete this IP pool?")) return;
    await deletePool.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/ip-pools"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Network Infrastructure</h1>
        <p className="text-gray-500 text-sm">Manage routers, equipment, and IP resources.</p>
      </div>

      <Tabs defaultValue="routers" className="w-full">
        <TabsList className="bg-gray-100">
          <TabsTrigger value="routers" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Wifi className="w-4 h-4" /> Routers
            {routersData && (
              <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-xs px-1.5">{routersData.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="equipment" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Server className="w-4 h-4" /> Equipment
            {equipmentData && (
              <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-xs px-1.5">{equipmentData.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ippools" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Route className="w-4 h-4" /> IP Pools
            {ipPoolsData && (
              <Badge variant="secondary" className="ml-1 bg-gray-200 text-gray-700 text-xs px-1.5">{ipPoolsData.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="hotspot" className="gap-1.5 data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Wifi className="w-4 h-4" /> Hotspot
          </TabsTrigger>
        </TabsList>

        {/* ── ROUTERS ───────────────────────────────────────────────────── */}
        <TabsContent value="routers" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm"
                onClick={() => setRouterDialog({ open: true })}>
                <Plus className="w-4 h-4 mr-2" /> Add Router
              </Button>
            </div>
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRouters ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : routersData && routersData.length > 0 ? (
                  routersData.map((r) => (
                    <TableRow key={r.id} className="hover:bg-gray-50/50">
                      <TableCell>
                        <div className={`w-2 h-2 rounded-full mx-auto ${r.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-xs ${routerTypeBadgeClass(r.routerType)}`}>
                          {routerTypeLabel(r.routerType)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-600">
                        {r.ipAddress}{r.port ? `:${r.port}` : ""}
                      </TableCell>
                      <TableCell className="text-gray-500 text-sm">{r.location || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.enabled ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500"}>
                          {r.enabled ? "Active" : "Disabled"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-indigo-600"
                              title="Live RouterOS Dashboard"
                              asChild>
                              <Link href={`/network/routers/${r.id}`}>
                                <LayoutDashboard className="w-3.5 h-3.5" />
                              </Link>
                            </Button>
                          )}
                          {r.routerType === "routeros" && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-green-600"
                              title="Download VPN .rsc script"
                              onClick={() => window.open(`/api/routers/${r.id}/ros-script`, "_blank")}>
                              <FileCode2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                            onClick={() => setRouterDialog({
                              open: true, id: r.id,
                              initial: {
                                name: r.name, routerType: r.routerType, ipAddress: r.ipAddress,
                                port: r.port?.toString() ?? "", username: r.username, password: r.password ?? "",
                                description: r.description ?? "", location: r.location ?? "",
                                apiSsl: r.apiSsl ?? false,
                                sshPort: r.sshPort?.toString() ?? "", netconfPort: r.netconfPort?.toString() ?? "",
                                enabled: r.enabled,
                              },
                            })}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                            onClick={() => handleDeleteRouter(r.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-gray-400">
                      <Wifi className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No routers added yet.</p>
                      <Button variant="link" size="sm" className="mt-1 text-blue-600"
                        onClick={() => setRouterDialog({ open: true })}>
                        Add your first router →
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── EQUIPMENT ─────────────────────────────────────────────────── */}
        <TabsContent value="equipment" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm"
                onClick={() => setEquipDialog({ open: true })}>
                <Plus className="w-4 h-4 mr-2" /> Add Equipment
              </Button>
            </div>
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead className="w-10">Status</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Brand / Model</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingEquipment ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : equipmentData && equipmentData.length > 0 ? (
                  equipmentData.map((item) => (
                    <TableRow key={item.id} className="hover:bg-gray-50/50">
                      <TableCell>
                        <div className="flex items-center justify-center">
                          {statusDot(item.status)}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize bg-gray-100 text-gray-700 border-0 text-xs">
                          {item.type.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {item.brand && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 w-fit">
                              {item.brand}
                            </span>
                          )}
                          <span className="text-sm text-gray-600">{item.model}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-gray-600">{item.ipAddress}</TableCell>
                      <TableCell className="text-gray-500 text-sm">{item.location || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                            onClick={() => setEquipDialog({
                              open: true, id: item.id,
                              initial: {
                                name: item.name, type: item.type, model: item.model,
                                brand: item.brand ?? "", ipAddress: item.ipAddress,
                                macAddress: item.macAddress ?? "", location: item.location ?? "",
                                status: item.status, notes: item.notes ?? "",
                              },
                            })}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                            onClick={() => handleDeleteEquipment(item.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-gray-400">
                      <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No equipment found.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── IP POOLS ──────────────────────────────────────────────────── */}
        <TabsContent value="ippools" className="mt-6">
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" size="sm"
                onClick={() => setPoolDialog({ open: true })}>
                <Plus className="w-4 h-4 mr-2" /> Add IP Pool
              </Button>
            </div>
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Pool Name / CIDR</TableHead>
                  <TableHead className="w-1/4">Usage</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>DNS Servers</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingIpPools ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : ipPoolsData && ipPoolsData.length > 0 ? (
                  ipPoolsData.map((pool) => {
                    const usagePct = Math.round((pool.usedIps / Math.max(pool.totalIps, 1)) * 100);
                    return (
                      <TableRow key={pool.id} className="hover:bg-gray-50/50">
                        <TableCell>
                          <div className="font-medium text-gray-900">{pool.name}</div>
                          <code className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                            {pool.network}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 w-full pr-4">
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>{pool.usedIps} used</span>
                              <span>{pool.totalIps - pool.usedIps} free</span>
                            </div>
                            <Progress value={usagePct} className={`h-2 ${usagePct > 85 ? "[&>div]:bg-red-500" : usagePct > 60 ? "[&>div]:bg-yellow-500" : "[&>div]:bg-green-500"}`} />
                            <div className="text-right text-xs font-medium text-gray-600">{usagePct}%</div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-gray-600">{pool.gateway}</TableCell>
                        <TableCell className="font-mono text-sm text-gray-500">
                          {pool.dns1 || "—"}{pool.dns2 ? <>, <br />{pool.dns2}</> : ""}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                              onClick={() => setPoolDialog({
                                open: true, id: pool.id,
                                initial: {
                                  name: pool.name, network: pool.network, gateway: pool.gateway,
                                  subnetMask: pool.subnetMask, dns1: pool.dns1 ?? "",
                                  dns2: pool.dns2 ?? "", description: pool.description ?? "",
                                },
                              })}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600"
                              onClick={() => handleDeletePool(pool.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center text-gray-400">
                      <Route className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No IP pools configured.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── HOTSPOT ───────────────────────────────────────────────────── */}
        <TabsContent value="hotspot" className="mt-6">
          <div className="space-y-4">
            <div className="bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-5">
              <div className="flex items-start gap-4">
                <div className="bg-violet-600 p-2.5 rounded-xl shrink-0">
                  <Wifi className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-violet-900 mb-1">Hotspot Management</h3>
                  <p className="text-sm text-violet-700 mb-3">
                    Each RouterOS router can run its own hotspot with a branded M-Pesa captive portal.
                    Select a router below to configure its hotspot, manage packages, and view voucher history.
                  </p>
                  <p className="text-xs text-violet-500">
                    Features: M-Pesa STK Push payments · Per-session voucher provisioning · Speed tier profiles · MAC auto-login · Walled garden for Safaricom APIs
                  </p>
                </div>
              </div>
            </div>

            {loadingRouters ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
              </div>
            ) : routersData && routersData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {routersData.filter(r => r.routerType === "routeros").map(router => (
                  <div key={router.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:border-violet-300 hover:shadow-md transition-all">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-900">{router.name}</h4>
                        <p className="text-xs text-gray-500 mt-0.5">{router.ipAddress}</p>
                        {router.location && <p className="text-xs text-gray-400">{router.location}</p>}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 bg-violet-50 text-violet-700 border-violet-200">
                        RouterOS
                      </Badge>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Link href={`/network/routers/${router.id}/hotspot`}
                        className="flex-1 text-center bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors">
                        Manage Hotspot
                      </Link>
                      <a href={`/hotspot/${router.id}`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium px-3 py-2 rounded-lg transition-colors">
                        Portal
                      </a>
                    </div>
                  </div>
                ))}
                {routersData.filter(r => r.routerType !== "routeros").length > 0 && (
                  <div className="col-span-full">
                    <p className="text-xs text-gray-400 text-center py-2">
                      {routersData.filter(r => r.routerType !== "routeros").length} non-RouterOS device(s) not shown — Hotspot is only supported on MikroTik RouterOS
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
                <Wifi className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-medium mb-1">No RouterOS devices yet</p>
                <p className="text-sm text-gray-400 mb-4">Add a MikroTik router on the Routers tab to enable hotspot management.</p>
                <button
                  className="text-blue-600 text-sm font-medium hover:underline"
                  onClick={() => {
                    const el = document.querySelector<HTMLButtonElement>('[data-value="routers"]') ?? document.querySelector<HTMLButtonElement>('[value="routers"]');
                    el?.click();
                  }}
                >
                  Go to Routers tab →
                </button>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <RouterDialog
        open={routerDialog.open}
        onClose={() => setRouterDialog({ open: false })}
        initial={routerDialog.initial}
        routerId={routerDialog.id}
      />
      <EquipmentDialog
        open={equipDialog.open}
        onClose={() => setEquipDialog({ open: false })}
        initial={equipDialog.initial}
        equipmentId={equipDialog.id}
      />
      <IpPoolDialog
        open={poolDialog.open}
        onClose={() => setPoolDialog({ open: false })}
        initial={poolDialog.initial}
        poolId={poolDialog.id}
      />
    </div>
  );
}
