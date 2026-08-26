import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  MapPin, Wifi, WifiOff, Plus, Pencil, Trash2, RefreshCw,
  Users, GitFork, LocateFixed, X, Save, ChevronDown, ChevronUp,
  Signal, Clock, Download, Upload, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CompanyScopeEmptyState, CompanyScopePicker } from "@/components/company-scope-picker";
import { useOwnerCompanyScope, type OwnerCompanyScope } from "@/hooks/useOwnerCompanyScope";

// Leaflet dynamic import (avoids SSR issues + fixes Vite icon paths)
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default marker icons broken by Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Custom icons ──────────────────────────────────────────────────────────────

function makeIcon(color: string, size = 32) {
  return L.divIcon({
    className: "",
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
    html: `<svg width="${size}" height="${size}" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C9.373 0 4 5.373 4 12c0 9 12 28 12 28S28 21 28 12C28 5.373 22.627 0 16 0z" fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="12" r="5" fill="white"/>
    </svg>`,
  });
}

const ICONS = {
  online:   makeIcon("#22c55e"),
  offline:  makeIcon("#ef4444"),
  inactive: makeIcon("#94a3b8"),
  splitter: makeIcon("#f97316", 36),
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface MapClient {
  id: number;
  name: string;
  phone: string;
  address: string;
  status: string;
  latitude: number;
  longitude: number;
  pppoeUsername: string | null;
  subStatus: string | null;
  planName: string | null;
  planPrice: number | null;
  routerId: number | null;
  online: boolean;
  ipAddress: string | null;
  macAddress: string | null;
  deviceVendor: string | null;
  uptimeSecs: number | null;
  routerName: string | null;
  bytesIn: number | null;
  bytesOut: number | null;
}

interface MapSplitter {
  id: number;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  routerId: number | null;
  routerName?: string | null;
  capacity: number | null;
  location: string | null;
  fiberColor: string | null;
}

interface MapData { clients: MapClient[]; splitters: MapSplitter[] }

interface SplitterRow extends MapSplitter { routerName: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUptime(secs: number | null): string {
  if (secs == null) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

// ── Map auto-fit ──────────────────────────────────────────────────────────────

function AutoFit({ clients, splitters }: { clients: MapClient[]; splitters: MapSplitter[] }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const all = [
      ...clients.map(c => [c.latitude, c.longitude] as [number, number]),
      ...splitters.map(s => [s.latitude, s.longitude] as [number, number]),
    ];
    if (all.length === 0) return;
    if (all.length === 1) { map.setView(all[0]!, 15); }
    else { map.fitBounds(L.latLngBounds(all), { padding: [40, 40] }); }
    fitted.current = true;
  }, [clients, splitters, map]);
  return null;
}

// ── Map click to pick coords ──────────────────────────────────────────────────

function MapClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng);
    map.on("click", handler);
    return () => { map.off("click", handler); };
  }, [map, onPick]);
  return null;
}

// ── Client popup ──────────────────────────────────────────────────────────────

function ClientPopup({ c }: { c: MapClient }) {
  return (
    <div className="min-w-[220px] space-y-2 text-sm">
      <div className="flex items-center gap-2 font-semibold text-base border-b pb-1.5">
        {c.online
          ? <Wifi className="w-4 h-4 text-green-500 shrink-0" />
          : <WifiOff className="w-4 h-4 text-red-400 shrink-0" />
        }
        <Link href={`/customers/${c.id}`}>
          <span className="text-blue-600 hover:underline cursor-pointer">{c.name}</span>
        </Link>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {c.pppoeUsername && <tr><td className="text-gray-400 pr-2">Account</td><td className="font-mono font-semibold">{c.pppoeUsername}</td></tr>}
          {c.planName      && <tr><td className="text-gray-400 pr-2">Package</td><td>{c.planName} {c.planPrice ? `— KES ${c.planPrice.toLocaleString()}` : ""}</td></tr>}
          <tr><td className="text-gray-400 pr-2">Status</td><td>
            <span className={`font-semibold ${c.online ? "text-green-600" : "text-red-500"}`}>
              {c.online ? "Online" : "Offline"}
            </span>
          </td></tr>
          {c.online && <>
            {c.deviceVendor && <tr><td className="text-gray-400 pr-2">Device</td><td>{c.deviceVendor}</td></tr>}
            {c.macAddress   && <tr><td className="text-gray-400 pr-2">MAC</td><td className="font-mono">{c.macAddress}</td></tr>}
            {c.ipAddress    && <tr><td className="text-gray-400 pr-2">IP</td><td className="font-mono">{c.ipAddress}</td></tr>}
            <tr><td className="text-gray-400 pr-2">Uptime</td><td>{fmtUptime(c.uptimeSecs)}</td></tr>
            <tr>
              <td className="text-gray-400 pr-2">Traffic</td>
              <td>↓{fmtBytes(c.bytesIn)} ↑{fmtBytes(c.bytesOut)}</td>
            </tr>
            {c.routerName && <tr><td className="text-gray-400 pr-2">Router</td><td>{c.routerName}</td></tr>}
          </>}
          {c.phone    && <tr><td className="text-gray-400 pr-2">Phone</td><td>{c.phone}</td></tr>}
          {c.address  && <tr><td className="text-gray-400 pr-2">Address</td><td className="text-gray-600">{c.address}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Splitter popup ────────────────────────────────────────────────────────────

function SplitterPopup({ s }: { s: MapSplitter }) {
  return (
    <div className="min-w-[180px] space-y-1.5 text-sm">
      <div className="flex items-center gap-2 font-semibold text-base border-b pb-1.5">
        <GitFork className="w-4 h-4 text-orange-500 shrink-0" />
        {s.name}
      </div>
      <table className="w-full text-xs">
        <tbody>
          {s.location    && <tr><td className="text-gray-400 pr-2">Location</td><td>{s.location}</td></tr>}
          {s.capacity    != null && <tr><td className="text-gray-400 pr-2">Capacity</td><td>{s.capacity} ports</td></tr>}
          {s.routerName  && <tr><td className="text-gray-400 pr-2">Router</td><td>{s.routerName}</td></tr>}
          {s.fiberColor  && <tr><td className="text-gray-400 pr-2">Fiber</td><td><span className="inline-block w-3 h-3 rounded-full mr-1 align-middle" style={{ background: s.fiberColor }} />{s.fiberColor}</td></tr>}
          {s.description && <tr><td colSpan={2} className="text-gray-500 pt-1">{s.description}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Splitter Form ─────────────────────────────────────────────────────────────

interface SplitterFormProps {
  open: boolean;
  onClose: () => void;
  initial?: Partial<SplitterRow>;
  pickingCoords?: { lat: number; lng: number } | null;
  companyScopeRequest: OwnerCompanyScope["companyScopeRequest"];
}

function SplitterFormDialog({ open, onClose, initial, pickingCoords, companyScopeRequest }: SplitterFormProps) {
  const qc = useQueryClient();
  const isEdit = !!initial?.id;
  const [name,        setName]        = useState(initial?.name        ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location,    setLocation]    = useState(initial?.location    ?? "");
  const [capacity,    setCapacity]    = useState(String(initial?.capacity ?? "8"));
  const [fiberColor,  setFiberColor]  = useState(initial?.fiberColor  ?? "");
  const [lat,         setLat]         = useState(String(initial?.latitude  ?? ""));
  const [lng,         setLng]         = useState(String(initial?.longitude ?? ""));
  const [picking,     setPicking]     = useState(false);

  // When map click propagates a coord while in picking mode
  useEffect(() => {
    if (picking && pickingCoords) {
      setLat(pickingCoords.lat.toFixed(6));
      setLng(pickingCoords.lng.toFixed(6));
      setPicking(false);
    }
  }, [pickingCoords, picking]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { name, description: description || null, location: location || null, capacity: parseInt(capacity) || 8, fiberColor: fiberColor || null, latitude: lat ? parseFloat(lat) : null, longitude: lng ? parseFloat(lng) : null };
      const url    = isEdit ? `${API}/api/splitters/${initial!.id}` : `${API}/api/splitters`;
      const method = isEdit ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...companyScopeRequest?.headers },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Save failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["network-map"] }); qc.invalidateQueries({ queryKey: ["splitters"] }); onClose(); },
  });

  const getBrowserLoc = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      setLat(pos.coords.latitude.toFixed(6));
      setLng(pos.coords.longitude.toFixed(6));
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Splitter" : "Add Splitter"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Splitter 1 - Zone A" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Location</Label><Input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Pole 14, Main Rd" /></div>
            <div className="space-y-1">
              <Label>Capacity (ports)</Label>
              <Select value={capacity} onValueChange={setCapacity}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[2,4,8,16,32,64].map(n => <SelectItem key={n} value={String(n)}>{n} ports</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Notes about this splitter…" /></div>
          <div className="space-y-1"><Label>Fiber Color</Label><Input value={fiberColor} onChange={e => setFiberColor(e.target.value)} placeholder="e.g. #ff6600 or 'orange'" /></div>
          <div className="space-y-1.5">
            <Label>Coordinates</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input value={lat} onChange={e => setLat(e.target.value)} placeholder="Latitude" className="font-mono text-sm" />
              <Input value={lng} onChange={e => setLng(e.target.value)} placeholder="Longitude" className="font-mono text-sm" />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-xs" onClick={getBrowserLoc}>
                <LocateFixed className="w-3 h-3" /> My Location
              </Button>
              <Button type="button" variant="outline" size="sm" className={`gap-1.5 text-xs ${picking ? "bg-blue-50 border-blue-400" : ""}`} onClick={() => setPicking(p => !p)}>
                <MapPin className="w-3 h-3" /> {picking ? "Click on map…" : "Pick on Map"}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name || save.isPending}>
            {save.isPending ? "Saving…" : isEdit ? "Save" : "Add Splitter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Customer Location Picker ───────────────────────────────────────────────────

function CustomerLocModal({
  open, onClose, pickingCoords, companyScopeRequest,
}: {
  open: boolean;
  onClose: () => void;
  pickingCoords: { lat: number; lng: number; customerId: number } | null;
  companyScopeRequest: OwnerCompanyScope["companyScopeRequest"];
}) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!pickingCoords) return;
    setSaving(true);
    await fetch(`${API}/api/customers/${pickingCoords.customerId}/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...companyScopeRequest?.headers },
      body: JSON.stringify({ latitude: pickingCoords.lat, longitude: pickingCoords.lng }),
    });
    setSaving(false);
    qc.invalidateQueries({ queryKey: ["network-map"] });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Confirm Customer Location</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2 text-sm">
          <p className="text-gray-600">Save this location for the customer?</p>
          {pickingCoords && (
            <div className="font-mono text-xs bg-gray-50 rounded p-2 border">
              {pickingCoords.lat.toFixed(6)}, {pickingCoords.lng.toFixed(6)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Location"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sidebar Panel ─────────────────────────────────────────────────────────────

function SidePanel({
  data, filter, setFilter, onAddSplitter, onEditSplitter, onDeleteSplitter,
}: {
  data: MapData | undefined;
  filter: string;
  setFilter: (f: string) => void;
  onAddSplitter: () => void;
  onEditSplitter: (s: MapSplitter) => void;
  onDeleteSplitter: (id: number) => void;
}) {
  const [tab, setTab] = useState<"clients"|"splitters">("clients");
  const [showAll, setShowAll] = useState(false);

  const clients   = data?.clients   ?? [];
  const splitters = data?.splitters ?? [];
  const online    = clients.filter(c => c.online).length;
  const located   = clients.length;

  const shown = showAll ? clients : clients.slice(0, 15);

  return (
    <div className="w-72 bg-white border-r flex flex-col shrink-0 h-full overflow-hidden">
      {/* Stats strip */}
      <div className="p-3 border-b bg-gray-50 grid grid-cols-3 gap-2 text-center">
        <div><p className="text-lg font-bold text-green-600">{online}</p><p className="text-[10px] text-gray-500">Online</p></div>
        <div><p className="text-lg font-bold text-gray-700">{located}</p><p className="text-[10px] text-gray-500">Mapped</p></div>
        <div><p className="text-lg font-bold text-orange-500">{splitters.length}</p><p className="text-[10px] text-gray-500">Splitters</p></div>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {(["clients","splitters"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium capitalize ${tab === t ? "border-b-2 border-blue-500 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>
            {t === "clients" ? `Clients (${located})` : `Splitters (${splitters.length})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "clients" && (
          <div>
            {/* Filter */}
            <div className="p-2 border-b">
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  <SelectItem value="online">Online only</SelectItem>
                  <SelectItem value="offline">Offline only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {shown.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6">No clients with coordinates.<br />Add coordinates in the customer form.</p>
            )}
            {shown.filter(c => filter === "all" || (filter === "online" && c.online) || (filter === "offline" && !c.online)).map(c => (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 border-b hover:bg-gray-50 text-xs">
                <div className={`w-2 h-2 rounded-full shrink-0 ${c.online ? "bg-green-500" : "bg-red-400"}`} />
                <div className="flex-1 min-w-0">
                  <Link href={`/customers/${c.id}`}>
                    <p className="font-medium text-blue-600 hover:underline truncate cursor-pointer">{c.name}</p>
                  </Link>
                  {c.pppoeUsername && <p className="font-mono text-gray-400 truncate">{c.pppoeUsername}</p>}
                  {c.online && c.uptimeSecs != null && <p className="text-green-600">↑ {fmtUptime(c.uptimeSecs)}</p>}
                </div>
              </div>
            ))}
            {clients.length > 15 && (
              <button className="w-full py-2 text-xs text-blue-600 hover:bg-blue-50 flex items-center justify-center gap-1"
                onClick={() => setShowAll(a => !a)}>
                {showAll ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Show all {clients.length}</>}
              </button>
            )}
          </div>
        )}

        {tab === "splitters" && (
          <div>
            <div className="p-2 border-b">
              <Button size="sm" className="w-full gap-1.5 h-7 text-xs" onClick={onAddSplitter}>
                <Plus className="w-3 h-3" /> Add Splitter
              </Button>
            </div>
            {splitters.length === 0 && (
              <p className="text-xs text-gray-400 text-center py-6">No splitters yet.<br />Click "Add Splitter" to add one.</p>
            )}
            {splitters.map(s => (
              <div key={s.id} className="px-3 py-2 border-b hover:bg-gray-50 text-xs group">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-800 truncate">{s.name}</p>
                    {s.location && <p className="text-gray-400 truncate">{s.location}</p>}
                    <p className="text-orange-500">{s.capacity ?? 8} ports</p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                    <button onClick={() => onEditSplitter(s)} className="p-1 hover:bg-gray-200 rounded"><Pencil className="w-3 h-3 text-gray-500" /></button>
                    <button onClick={() => { if (confirm(`Delete splitter "${s.name}"?`)) onDeleteSplitter(s.id); }} className="p-1 hover:bg-red-100 rounded"><Trash2 className="w-3 h-3 text-red-400" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function NetworkMap() {
  const qc = useQueryClient();
  const scope = useOwnerCompanyScope("network-map");
  const [filter,         setFilter]        = useState("all");
  const [showSplitter,   setShowSplitter]  = useState(false);
  const [editSplitter,   setEditSplitter]  = useState<MapSplitter | undefined>(undefined);
  const [pickedCoords,   setPickedCoords]  = useState<{ lat: number; lng: number } | null>(null);

  // Default map center: Nairobi
  const defaultCenter: [number, number] = [-1.286389, 36.817223];

  const { data, isLoading, isFetching, refetch } = useQuery<MapData>({
    queryKey: ["network-map", scope.selectedCompanyId],
    queryFn: async () => {
      const r = await fetch(`${API}/api/network-map`, {
        credentials: "include",
        headers: { ...scope.companyScopeRequest?.headers },
      });
      if (!r.ok) throw new Error(`Failed to load map data (${r.status})`);
      return r.json() as Promise<MapData>;
    },
    enabled: scope.scopeReady,
    refetchInterval: 30_000,
  });

  const deleteSplitter = useMutation({
    mutationFn: async (id: number) => fetch(`${API}/api/splitters/${id}`, {
      method: "DELETE",
      headers: { ...scope.companyScopeRequest?.headers },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["network-map"] }),
  });

  const clients   = (data?.clients   ?? []).filter(c => filter === "all" || (filter === "online" && c.online) || (filter === "offline" && !c.online));
  const splitters = data?.splitters ?? [];

  return (
    <div className="space-y-5">
      <CompanyScopePicker
        scope={scope}
        id="network-map-company-scope"
        title="Choose a customer company"
        description="Choose the company whose network map, customers, and splitters you want to view or manage."
      />
      {!scope.scopeReady ? (
        <CompanyScopeEmptyState
          title="Choose a company to view its network map"
          description="Select a customer company above before viewing its mapped customers and splitters."
        />
      ) : (
    <div className="h-[calc(100vh-120px)] flex flex-col" style={{ minHeight: 500 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Network Map</h1>
          <p className="text-sm text-gray-500">
            {data?.clients?.length ?? 0} clients mapped · {data?.clients?.filter(c => c.online).length ?? 0} online · {splitters.length} splitters
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Map + sidebar */}
      <div className="flex flex-1 rounded-xl overflow-hidden border shadow-sm" style={{ minHeight: 400 }}>
        {/* Side panel */}
        <SidePanel
          data={data}
          filter={filter}
          setFilter={setFilter}
          onAddSplitter={() => { setEditSplitter(undefined); setShowSplitter(true); }}
          onEditSplitter={s => { setEditSplitter(s); setShowSplitter(true); }}
          onDeleteSplitter={id => deleteSplitter.mutate(id)}
        />

        {/* Map */}
        <div className="flex-1 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
              <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          )}

          {/* Legend */}
          <div className="absolute top-3 right-3 z-[1000] bg-white rounded-lg border shadow-md p-2 text-xs space-y-1.5">
            <p className="font-semibold text-gray-700 text-xs mb-1">Legend</p>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500 inline-block shrink-0" /> Online client</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-400 inline-block shrink-0" /> Offline client</div>
            <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-orange-500 inline-block shrink-0" /> Splitter</div>
          </div>

          {/* Pick mode hint */}
          {showSplitter && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full shadow">
              Click anywhere on the map to set splitter coordinates
            </div>
          )}

          <MapContainer
            center={defaultCenter}
            zoom={12}
            style={{ height: "100%", width: "100%" }}
            zoomControl={true}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />

            {data && <AutoFit clients={data.clients} splitters={data.splitters} />}

            {/* Coord picker for splitter form */}
            {showSplitter && <MapClickPicker onPick={(lat, lng) => setPickedCoords({ lat, lng })} />}

            {/* Client markers */}
            {clients.map(c => (
              <Marker
                key={`c-${c.id}`}
                position={[c.latitude, c.longitude]}
                icon={c.online ? ICONS.online : (c.subStatus === "active" ? ICONS.offline : ICONS.inactive)}
              >
                <Popup maxWidth={280} minWidth={220}>
                  <ClientPopup c={c} />
                </Popup>
              </Marker>
            ))}

            {/* Splitter markers */}
            {splitters.map(s => (
              <Marker
                key={`s-${s.id}`}
                position={[s.latitude, s.longitude]}
                icon={ICONS.splitter}
              >
                <Popup maxWidth={240} minWidth={180}>
                  <SplitterPopup s={s} />
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>

      {/* Help text */}
      {(data?.clients?.length ?? 0) === 0 && !isLoading && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 flex items-start gap-2">
          <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
          <span>No clients with coordinates yet. Go to <Link href="/customers"><strong className="underline cursor-pointer">Customers</strong></Link>, edit a customer, and use the <strong>📍 Get Location</strong> button or enter coordinates manually. They'll appear on this map automatically.</span>
        </div>
      )}

      {/* Splitter form */}
      {showSplitter && (
        <SplitterFormDialog
          open={showSplitter}
          onClose={() => { setShowSplitter(false); setPickedCoords(null); }}
          initial={editSplitter}
          pickingCoords={pickedCoords}
          companyScopeRequest={scope.companyScopeRequest}
        />
      )}
    </div>
      )}
    </div>
  );
}
