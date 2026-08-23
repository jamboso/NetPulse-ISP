import { useState } from "react";
import {
  useCreateOlt, useCreateOltServiceProfile, useDeleteOlt, useDeleteOltServiceProfile,
  useDiscoverOltInventory, useListOltProvisioningJobs, useListOltServiceProfiles,
  useListOlts, useListOnus, useListOltCompatibilityProfiles, getListOltsQueryKey, getListOnusQueryKey,
  getListOltProvisioningJobsQueryKey, getListOltServiceProfilesQueryKey,
  type OltInput, type OltServiceProfileInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Box, Cable, CheckCircle2, Circle, Loader2, Plus, Radio, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type OltForm = {
  name: string;
  vendor: string;
  model: string;
  firmwareVersion: string;
  ponTechnology: "epon" | "gpon";
  managementHost: string;
  managementPort: string;
  managementProtocol: "snmp-v2c" | "snmp-v3" | "ssh" | "https" | "telnet";
  managementUsername: string;
  managementSecret: string;
  location: string;
};

type ProfileForm = {
  name: string;
  vlanId: string;
  accessMode: "bridge" | "router" | "pppoe" | "dhcp";
  downstreamKbps: string;
  upstreamKbps: string;
};

const OLT_DEFAULTS: OltForm = {
  name: "", vendor: "HIOSO", model: "", firmwareVersion: "", ponTechnology: "epon",
  managementHost: "", managementPort: "161", managementProtocol: "snmp-v2c",
  managementUsername: "", managementSecret: "", location: "",
};

const PROFILE_DEFAULTS: ProfileForm = {
  name: "", vlanId: "", accessMode: "bridge", downstreamKbps: "", upstreamKbps: "",
};

function healthBadge(state: string) {
  if (state === "online") return <Badge className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50"><CheckCircle2 className="mr-1 h-3 w-3" />Online</Badge>;
  if (state === "offline") return <Badge className="bg-red-50 text-red-700 border border-red-200 hover:bg-red-50"><Circle className="mr-1 h-3 w-3" />Offline</Badge>;
  return <Badge variant="outline" className="text-gray-500"><Circle className="mr-1 h-3 w-3" />Not checked</Badge>;
}

export function FiberAccessWorkspace({ canManageNetwork, canDeleteNetworkRecords }: { canManageNetwork: boolean; canDeleteNetworkRecords: boolean }) {
  const queryClient = useQueryClient();
  const { data: olts, isLoading: oltsLoading, isError: oltsError } = useListOlts();
  const { data: onus, isLoading: onusLoading } = useListOnus();
  const { data: profiles, isLoading: profilesLoading } = useListOltServiceProfiles();
  const { data: jobs, isLoading: jobsLoading } = useListOltProvisioningJobs();
  const { data: compatibilityProfiles, isLoading: compatibilityLoading } = useListOltCompatibilityProfiles();
  const createOlt = useCreateOlt();
  const deleteOlt = useDeleteOlt();
  const discoverOlt = useDiscoverOltInventory();
  const createProfile = useCreateOltServiceProfile();
  const deleteProfile = useDeleteOltServiceProfile();

  const [oltDialogOpen, setOltDialogOpen] = useState(false);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [oltForm, setOltForm] = useState<OltForm>(OLT_DEFAULTS);
  const [profileForm, setProfileForm] = useState<ProfileForm>(PROFILE_DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [discoveringId, setDiscoveringId] = useState<number | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListOltsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListOnusQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListOltProvisioningJobsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListOltServiceProfilesQueryKey() }),
    ]);
  };

  const saveOlt = async () => {
    setError(null);
    try {
      await createOlt.mutateAsync({
        data: {
          ...oltForm,
          firmwareVersion: oltForm.firmwareVersion || null,
          managementPort: Number(oltForm.managementPort),
          managementUsername: oltForm.managementUsername || undefined,
          location: oltForm.location || null,
        } as OltInput,
      });
      await refresh();
      setOltDialogOpen(false);
      setOltForm(OLT_DEFAULTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the OLT.");
    }
  };

  const saveProfile = async () => {
    setError(null);
    try {
      await createProfile.mutateAsync({
        data: {
          name: profileForm.name,
          vlanId: Number(profileForm.vlanId),
          accessMode: profileForm.accessMode,
          downstreamKbps: profileForm.downstreamKbps ? Number(profileForm.downstreamKbps) : null,
          upstreamKbps: profileForm.upstreamKbps ? Number(profileForm.upstreamKbps) : null,
        } as OltServiceProfileInput,
      });
      await refresh();
      setProfileDialogOpen(false);
      setProfileForm(PROFILE_DEFAULTS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the service profile.");
    }
  };

  const discover = async (id: number) => {
    setError(null);
    setDiscoveringId(id);
    try {
      await discoverOlt.mutateAsync({ id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery could not be completed.");
    } finally {
      setDiscoveringId(null);
    }
  };

  const removeOlt = async (id: number, name: string) => {
    if (!confirm(`Remove ${name} and its discovered fiber inventory? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteOlt.mutateAsync({ id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the OLT.");
    }
  };

  const removeProfile = async (id: number) => {
    if (!confirm("Delete this service profile?")) return;
    setError(null);
    try {
      await deleteProfile.mutateAsync({ id });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the service profile.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex gap-3">
            <div className="rounded-lg bg-sky-600 p-2.5 text-white"><Cable className="h-5 w-5" /></div>
            <div>
              <h2 className="font-semibold text-gray-900">Fiber Access</h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-600">Register OLTs, inspect discovered ONUs, and prepare approved service profiles. Discovery is read-only until a verified vendor adapter is enabled.</p>
            </div>
          </div>
          {canManageNetwork && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setProfileDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Service profile</Button>
              <Button size="sm" className="bg-sky-700 hover:bg-sky-800" onClick={() => setOltDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Add OLT</Button>
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-sky-100 bg-white/80 p-3"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Managed OLTs</p><p className="mt-1 text-2xl font-semibold text-gray-900">{olts?.length ?? "—"}</p></div>
          <div className="rounded-lg border border-sky-100 bg-white/80 p-3"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Detected ONUs</p><p className="mt-1 text-2xl font-semibold text-gray-900">{onus?.length ?? "—"}</p></div>
          <div className="rounded-lg border border-sky-100 bg-white/80 p-3"><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Service profiles</p><p className="mt-1 text-2xl font-semibold text-gray-900">{profiles?.length ?? "—"}</p></div>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3"><ShieldCheck className="h-4 w-4 text-amber-700" /><div><h3 className="font-medium text-gray-900">Vendor compatibility catalog</h3><p className="text-xs text-gray-500">Listed models can verify their standard SNMP identity only. Exact firmware and lab evidence are still required for PON/ONU inventory or any configuration workflow.</p></div></div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {compatibilityLoading ? Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-36 w-full" />)
            : compatibilityProfiles?.length ? compatibilityProfiles.map((profile) => <div key={`${profile.vendor}-${profile.models.join("-")}`} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold text-gray-900">{profile.vendor}</p><p className="mt-0.5 text-xs text-gray-700">{profile.models.join(" · ")}</p></div><Badge variant="outline" className="border-sky-200 bg-white text-sky-800">Identity only</Badge></div>
              <p className="mt-2 text-xs text-gray-700">{profile.ponTechnologies.join(" / ").toUpperCase()} · {profile.ponPortCapacity}</p>
              <p className="mt-2 text-[11px] leading-4 text-gray-500">{profile.firmwareRequirement}</p>
            </div>)
            : <p className="col-span-full py-3 text-sm text-gray-500">Compatibility profiles are unavailable right now.</p>}
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3"><Radio className="h-4 w-4 text-sky-700" /><h3 className="font-medium text-gray-900">OLT inventory</h3></div>
        <Table>
          <TableHeader className="bg-gray-50"><TableRow><TableHead>Name</TableHead><TableHead>Vendor / model</TableHead><TableHead>Compatibility</TableHead><TableHead>PON</TableHead><TableHead>Management</TableHead><TableHead>Health</TableHead><TableHead className="w-36">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {oltsLoading ? Array.from({ length: 3 }).map((_, index) => <TableRow key={index}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>)
              : oltsError ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-red-600">Could not load the OLT inventory.</TableCell></TableRow>
              : olts?.length ? olts.map((olt) => <TableRow key={olt.id}>
                <TableCell><div className="font-medium text-gray-900">{olt.name}</div><div className="text-xs text-gray-500">{olt.location || "No location"}</div></TableCell>
                <TableCell><div className="text-sm font-medium">{olt.vendor}</div><div className="text-xs text-gray-500">{olt.model}{olt.firmwareVersion ? ` · ${olt.firmwareVersion}` : " · Firmware not recorded"}</div></TableCell>
                <TableCell><div title={olt.capability.message}><Badge variant="outline" className={olt.capability.status === "mib-validated-read-only" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : olt.capability.status === "standard-identity-read-only" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{olt.capability.status === "mib-validated-read-only" ? "MIB inventory" : olt.capability.status === "standard-identity-read-only" ? "Identity only" : "Read-only"}</Badge><div className="mt-1 max-w-52 text-[11px] leading-4 text-gray-500">{olt.capability.message}</div></div></TableCell>
                <TableCell><Badge variant="outline" className="uppercase">{olt.ponTechnology}</Badge></TableCell>
                <TableCell className="font-mono text-xs text-gray-600">{olt.managementHost}:{olt.managementPort}<div className="mt-1 font-sans text-[11px] text-gray-400">{olt.managementProtocol}</div></TableCell>
                <TableCell>{healthBadge(olt.healthState)}</TableCell>
                <TableCell><div className="flex gap-1">
                  {canManageNetwork && <Button variant="outline" size="sm" className="h-7 text-xs" disabled={discoveringId === olt.id} onClick={() => void discover(olt.id)}>{discoveringId === olt.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}Discover</Button>}
                  {canDeleteNetworkRecords && <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600" aria-label={`Remove ${olt.name}`} onClick={() => void removeOlt(olt.id, olt.name)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                </div></TableCell>
              </TableRow>)
              : <TableRow><TableCell colSpan={7} className="py-10 text-center text-gray-500"><Cable className="mx-auto mb-2 h-7 w-7 opacity-30" /><p>No OLTs registered yet.</p>{canManageNetwork && <Button variant="link" className="mt-1 text-sky-700" onClick={() => setOltDialogOpen(true)}>Register the first OLT</Button>}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-indigo-700" /><h3 className="font-medium text-gray-900">Service profiles</h3></div><span className="text-xs text-gray-500">VLAN and access policy</span></div>
          <div className="divide-y divide-gray-100">
            {profilesLoading ? <div className="p-4"><Skeleton className="h-10 w-full" /></div>
              : profiles?.length ? profiles.map((profile) => <div key={profile.id} className="flex items-center gap-3 px-4 py-3"><div className="rounded-md bg-indigo-50 p-2 text-indigo-700"><Activity className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900">{profile.name}</p><p className="text-xs text-gray-500">VLAN {profile.vlanId} · {profile.accessMode.toUpperCase()} · ↓ {profile.downstreamKbps ?? "—"} / ↑ {profile.upstreamKbps ?? "—"} Kbps</p></div>{canDeleteNetworkRecords && <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600" aria-label={`Delete ${profile.name}`} onClick={() => void removeProfile(profile.id)}><Trash2 className="h-3.5 w-3.5" /></Button>}</div>)
              : <div className="px-4 py-8 text-center text-sm text-gray-500">Create a profile before running a provisioning dry run.</div>}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3"><div className="flex items-center gap-2"><Box className="h-4 w-4 text-emerald-700" /><h3 className="font-medium text-gray-900">Detected ONUs</h3></div><span className="text-xs text-gray-500">Read-only inventory</span></div>
          <div className="divide-y divide-gray-100">
            {onusLoading ? <div className="p-4"><Skeleton className="h-10 w-full" /></div>
              : onus?.length ? onus.slice(0, 5).map((onu) => <div key={onu.id} className="flex items-center gap-3 px-4 py-3"><div className="rounded-md bg-emerald-50 p-2 text-emerald-700"><Box className="h-4 w-4" /></div><div className="min-w-0"><p className="font-mono text-sm text-gray-900">{onu.serialNumber || onu.loid || "Unidentified ONU"}</p><p className="text-xs text-gray-500">{onu.vendor || "Unknown vendor"} {onu.model ? `· ${onu.model}` : ""} · {onu.provisioningState}</p></div></div>)
              : <div className="px-4 py-8 text-center text-sm text-gray-500">Run a read-only discovery after adding an OLT. Vendor adapters will populate ONU details.</div>}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-amber-700" /><h3 className="font-medium text-gray-900">Provisioning & discovery history</h3></div><span className="text-xs text-gray-500">Tenant-scoped and audit recorded</span></div>
        <div className="divide-y divide-gray-100">
          {jobsLoading ? <div className="p-4"><Skeleton className="h-10 w-full" /></div>
            : jobs?.length ? jobs.slice(0, 6).map((job) => <div key={job.id} className="flex items-center gap-3 px-4 py-3 text-sm"><Badge variant="outline" className="capitalize">{job.operation}</Badge><span className="font-medium capitalize">{job.status.replaceAll("_", " ")}</span><span className="text-xs text-gray-500">{job.dryRun ? "Dry run" : "Write request"}</span><span className="ml-auto text-xs text-gray-400">{new Date(job.createdAt).toLocaleString()}</span></div>)
            : <div className="px-4 py-8 text-center text-sm text-gray-500">No discovery or provisioning activity yet.</div>}
        </div>
      </section>

      <Dialog open={oltDialogOpen} onOpenChange={(open) => { setOltDialogOpen(open); if (!open) setError(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>Add OLT</DialogTitle><DialogDescription>Register an OLT for safe, read-only inventory discovery.</DialogDescription></DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Credentials are encrypted at rest and never returned to the browser. Discovery is read-only until a verified adapter is installed.</p>
            <div className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div><p className="text-xs font-medium text-sky-900">Validated HIOSO EPON profile</p><p className="mt-0.5 text-[11px] leading-4 text-sky-800">Use only for a HA7304VD running v1.1.28 over SNMP v2c. This enables read-only PON and ONU inventory.</p></div>
              <Button type="button" variant="outline" size="sm" className="shrink-0 border-sky-300 bg-white text-sky-800 hover:bg-sky-100" onClick={() => setOltForm({ ...oltForm, vendor: "HIOSO", model: "HA7304VD", firmwareVersion: "v1.1.28", ponTechnology: "epon", managementPort: "161", managementProtocol: "snmp-v2c" })}>Use HIOSO preset</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Name *</Label><Input value={oltForm.name} onChange={(event) => setOltForm({ ...oltForm, name: event.target.value })} placeholder="Main OLT" /></div>
              <div className="space-y-1"><Label>Vendor *</Label><Input value={oltForm.vendor} onChange={(event) => setOltForm({ ...oltForm, vendor: event.target.value })} placeholder="HIOSO" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Model *</Label><Input value={oltForm.model} onChange={(event) => setOltForm({ ...oltForm, model: event.target.value })} placeholder="FD1208S" /></div>
              <div className="space-y-1"><Label>PON technology *</Label><Select value={oltForm.ponTechnology} onValueChange={(value: OltForm["ponTechnology"]) => setOltForm({ ...oltForm, ponTechnology: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="epon">EPON</SelectItem><SelectItem value="gpon">GPON</SelectItem></SelectContent></Select></div>
            </div>
            <div className="space-y-1"><Label>Firmware version</Label><Input value={oltForm.firmwareVersion} onChange={(event) => setOltForm({ ...oltForm, firmwareVersion: event.target.value })} placeholder="e.g. v1.1.28" /><p className="text-[11px] text-gray-500">Exact firmware is required before a model can receive a MIB-specific compatibility profile.</p></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1"><Label>Management address *</Label><Input value={oltForm.managementHost} onChange={(event) => setOltForm({ ...oltForm, managementHost: event.target.value })} placeholder="10.0.0.10" /></div>
              <div className="space-y-1"><Label>Port *</Label><Input type="number" value={oltForm.managementPort} onChange={(event) => setOltForm({ ...oltForm, managementPort: event.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Management protocol *</Label><Select value={oltForm.managementProtocol} onValueChange={(value: OltForm["managementProtocol"]) => setOltForm({ ...oltForm, managementProtocol: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="snmp-v2c">SNMP v2c</SelectItem><SelectItem value="snmp-v3">SNMP v3</SelectItem><SelectItem value="ssh">SSH</SelectItem><SelectItem value="https">HTTPS</SelectItem><SelectItem value="telnet">Telnet</SelectItem></SelectContent></Select></div>
              <div className="space-y-1"><Label>Location</Label><Input value={oltForm.location} onChange={(event) => setOltForm({ ...oltForm, location: event.target.value })} placeholder="POP A" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Username / SNMP user</Label><Input autoComplete="off" value={oltForm.managementUsername} onChange={(event) => setOltForm({ ...oltForm, managementUsername: event.target.value })} /></div>
              <div className="space-y-1"><Label>Secret / SNMP community *</Label><Input type="password" autoComplete="new-password" value={oltForm.managementSecret} onChange={(event) => setOltForm({ ...oltForm, managementSecret: event.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOltDialogOpen(false)}>Cancel</Button><Button className="bg-sky-700 hover:bg-sky-800" disabled={createOlt.isPending || !oltForm.name || !oltForm.vendor || !oltForm.model || !oltForm.managementHost || !oltForm.managementSecret} onClick={() => void saveOlt()}>{createOlt.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Add OLT</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileDialogOpen} onOpenChange={(open) => { setProfileDialogOpen(open); if (!open) setError(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create service profile</DialogTitle><DialogDescription>Define a reusable access policy for a future approved provisioning job.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} placeholder="Home 20 Mbps" /></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>VLAN ID *</Label><Input type="number" value={profileForm.vlanId} onChange={(event) => setProfileForm({ ...profileForm, vlanId: event.target.value })} placeholder="100" /></div><div className="space-y-1"><Label>Access mode *</Label><Select value={profileForm.accessMode} onValueChange={(value: ProfileForm["accessMode"]) => setProfileForm({ ...profileForm, accessMode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bridge">Bridge</SelectItem><SelectItem value="router">Router</SelectItem><SelectItem value="pppoe">PPPoE</SelectItem><SelectItem value="dhcp">DHCP</SelectItem></SelectContent></Select></div></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-1"><Label>Download (Kbps)</Label><Input type="number" value={profileForm.downstreamKbps} onChange={(event) => setProfileForm({ ...profileForm, downstreamKbps: event.target.value })} /></div><div className="space-y-1"><Label>Upload (Kbps)</Label><Input type="number" value={profileForm.upstreamKbps} onChange={(event) => setProfileForm({ ...profileForm, upstreamKbps: event.target.value })} /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setProfileDialogOpen(false)}>Cancel</Button><Button className="bg-sky-700 hover:bg-sky-800" disabled={createProfile.isPending || !profileForm.name || !profileForm.vlanId} onClick={() => void saveProfile()}>{createProfile.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save profile</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}