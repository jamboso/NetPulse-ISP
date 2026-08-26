import { useState } from "react";
import { Link } from "wouter";
import { useListCustomers, useDeleteCustomer, listRouters, type RouterDevice } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBulkSelect } from "@/hooks/useBulkSelect";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Plus, Search, MoreHorizontal, Mail, Phone, MapPin, Pencil, Trash2, UserX, UserCheck, LocateFixed, Eye, EyeOff, Copy, Check, RefreshCw, Wifi, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatDate } from "@/lib/formatDate";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

type CustomerForm = {
  name: string; email: string; phone: string; address: string;
  status: string; notes: string; latitude: string; longitude: string;
  pppoeUsername: string; pppoePassword: string;
};
const EMPTY: CustomerForm = {
  name: "", email: "", phone: "", address: "",
  status: "active", notes: "", latitude: "", longitude: "",
  pppoeUsername: "", pppoePassword: "",
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, ".").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "").substring(0, 24);
}
function randPass(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function CustomerDialog({ open, onClose, initial, customerId }: {
  open: boolean; onClose: () => void; initial?: CustomerForm; customerId?: number;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CustomerForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [createdCreds, setCreatedCreds] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const set = (k: keyof CustomerForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const getGpsLocation = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        set("latitude",  pos.coords.latitude.toFixed(6));
        set("longitude", pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      () => setGpsLoading(false),
      { timeout: 8000 }
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        name:          form.name,
        email:         form.email,
        phone:         form.phone,
        address:       form.address,
        status:        form.status,
        notes:         form.notes || null,
        latitude:      form.latitude  ? parseFloat(form.latitude)  : null,
        longitude:     form.longitude ? parseFloat(form.longitude) : null,
        pppoeUsername: form.pppoeUsername || null,
        pppoePassword: form.pppoePassword || null,
      };
      const url    = customerId ? `${API}/api/customers/${customerId}` : `${API}/api/customers`;
      const method = customerId ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
      if (!r.ok) {
        const data = await r.json().catch(() => null);
        throw new Error(data?.error ?? data?.message ?? "Save failed");
      }
      const saved = await r.json();
      await qc.invalidateQueries({ queryKey: ["/api/customers"] });
      await qc.invalidateQueries({ queryKey: ["network-map"] });
      if (!customerId && saved.pppoeUsername && saved.pppoePassword) {
        setCreatedCreds({ username: saved.pppoeUsername, password: saved.pppoePassword });
      } else {
        onClose();
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally { setSaving(false); }
  };

  const hasCoords = !!form.latitude && !!form.longitude;

  return (
    <>
    <Dialog open={open && !createdCreds} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{customerId ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
        <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Full Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="John Doe" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="john@example.com" />
            </div>
            <div className="space-y-1">
              <Label>Phone *</Label>
              <Input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+254 700 000 000" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Address *</Label>
            <Textarea rows={2} className="resize-none" value={form.address} onChange={e => set("address", e.target.value)} placeholder="123 Main St, Nairobi" />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={2} className="resize-none" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>

          <div className="space-y-1.5 pt-1 border-t">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-blue-500" /> Map Location
                {hasCoords && <span className="text-[10px] font-normal text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 ml-1">Pinned ✓</span>}
              </Label>
              <Button type="button" variant="outline" size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={getGpsLocation}
                disabled={gpsLoading}
              >
                <LocateFixed className={`w-3 h-3 ${gpsLoading ? "animate-spin" : ""}`} />
                {gpsLoading ? "Getting…" : "Use My Location"}
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Latitude</Label>
                <Input className="font-mono text-sm h-8" value={form.latitude} onChange={e => set("latitude", e.target.value)} placeholder="-1.286389" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Longitude</Label>
                <Input className="font-mono text-sm h-8" value={form.longitude} onChange={e => set("longitude", e.target.value)} placeholder="36.817223" />
              </div>
            </div>
            {hasCoords && (
              <button type="button" className="text-[10px] text-gray-400 hover:text-red-500 underline underline-offset-2"
                onClick={() => { set("latitude", ""); set("longitude", ""); }}>
                Clear coordinates
              </button>
            )}
            <p className="text-[10px] text-gray-400">Coordinates place this customer on the Network Map.</p>
          </div>

          <div className="space-y-2 pt-1 border-t">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-blue-500" /> PPPoE Credentials
                <span className="text-[10px] font-normal text-gray-400 ml-1">optional</span>
              </Label>
              {!customerId && (
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs"
                  onClick={() => { set("pppoeUsername", slugify(form.name)); set("pppoePassword", randPass()); }}>
                  <RefreshCw className="w-3 h-3" /> Auto-fill
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Username</Label>
                <Input className="font-mono text-sm h-8" value={form.pppoeUsername}
                  onChange={e => set("pppoeUsername", e.target.value)} placeholder="john.doe" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Password</Label>
                <div className="relative">
                  <Input className="font-mono text-sm h-8 pr-8"
                    type={showPass ? "text" : "password"}
                    value={form.pppoePassword}
                    onChange={e => set("pppoePassword", e.target.value)} />
                  <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPass(p => !p)}>
                    {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">Credentials are synced to FreeRADIUS immediately on save.</p>
          </div>
        </div>

        {saveError && <p className="text-sm text-red-600 text-center px-1">{saveError}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.name || !form.email || !form.phone || !form.address}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {saving ? "Saving…" : customerId ? "Update" : "Add Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!createdCreds} onOpenChange={() => { setCreatedCreds(null); onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-500" /> Customer Created
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600">PPPoE credentials are ready. Share these with the technician installing the connection.</p>
        <div className="space-y-3 bg-gray-50 rounded-lg border p-3 mt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 w-20">Username</span>
            <span className="font-mono font-semibold text-gray-900 flex-1 truncate">{createdCreds?.username}</span>
            <button onClick={() => copyText(createdCreds!.username, "user")} className="text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0">
              {copied === "user" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="border-t" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500 w-20">Password</span>
            <span className="font-mono font-semibold text-gray-900 flex-1 truncate">{createdCreds?.password}</span>
            <button onClick={() => copyText(createdCreds!.password, "pass")} className="text-gray-400 hover:text-blue-600 transition-colors flex-shrink-0">
              {copied === "pass" ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-gray-400">Synced to FreeRADIUS. SMS delivery coming soon.</p>
        <DialogFooter>
          <Button className="w-full bg-green-600 hover:bg-green-700 text-white" onClick={() => { setCreatedCreds(null); onClose(); }}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active:     "bg-green-100 text-green-700 hover:bg-green-100",
  suspended:  "bg-orange-100 text-orange-700 hover:bg-orange-100",
  terminated: "bg-red-100 text-red-700 hover:bg-red-100",
};

export default function Customers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: customersData, isLoading, isError, error, refetch } = useListCustomers({ search, limit: 50 });
  const deleteMutation = useDeleteCustomer();
  const { canManageCustomers, canDeleteCustomers } = useCurrentUser();

  const [dialog, setDialog] = useState<{ open: boolean; id?: number; initial?: CustomerForm }>({ open: false });
  const [bulkWorking, setBulkWorking] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    mode: "single" | "bulk";
    ids: number[];
    label: string;
    loadingRouters: boolean;
    routersByCustomer: Map<number, RouterDevice[]>;
  } | null>(null);

  const customers = customersData?.data ?? [];
  const ids = customers.map(c => c.id);
  const { selected, toggle, toggleAll, clear, isAllSelected, isIndeterminate } = useBulkSelect(ids);

  const openDeleteConfirm = async (targetIds: number[], label: string, mode: "single" | "bulk") => {
    setDeleteConfirm({ open: true, mode, ids: targetIds, label, loadingRouters: true, routersByCustomer: new Map() });
    try {
      const perCustomer = await Promise.all(targetIds.map(async (id) => [id, await listRouters({ customerId: id })] as const));
      setDeleteConfirm(prev => prev && prev.open ? { ...prev, loadingRouters: false, routersByCustomer: new Map(perCustomer) } : prev);
    } catch {
      // If the router check fails, fall back to an unqualified warning rather than silently hiding the risk.
      setDeleteConfirm(prev => prev && prev.open ? { ...prev, loadingRouters: false } : prev);
    }
  };

  const handleDelete = (id: number, name: string) => openDeleteConfirm([id], name, "single");

  const handleStatusChange = async (id: number, status: string) => {
    await fetch(`${API}/api/customers/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    qc.invalidateQueries({ queryKey: ["/api/customers"] });
  };

  const handleBulkDelete = () => openDeleteConfirm([...selected], `${selected.size} customer(s)`, "bulk");

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setBulkWorking(true);
    try {
      await Promise.all(deleteConfirm.ids.map(id => deleteMutation.mutateAsync({ id })));
      if (deleteConfirm.mode === "bulk") clear();
      qc.invalidateQueries({ queryKey: ["/api/customers"] });
      qc.invalidateQueries({ queryKey: ["/api/routers"] });
      setDeleteConfirm(null);
    } finally { setBulkWorking(false); }
  };

  const handleBulkStatus = async (status: string) => {
    setBulkWorking(true);
    try {
      await Promise.all([...selected].map(id =>
        fetch(`${API}/api/customers/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        })
      ));
      clear();
      qc.invalidateQueries({ queryKey: ["/api/customers"] });
    } finally { setBulkWorking(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Customers</h1>
          <p className="text-gray-500 text-sm">Manage your customer base and their accounts.</p>
        </div>
        {canManageCustomers && (
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialog({ open: true })}>
            <Plus className="w-4 h-4 mr-2" /> Add Customer
          </Button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input placeholder="Search by name, email, or phone…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-gray-50 border-gray-200 focus-visible:ring-blue-500" />
          </div>
        </div>

        <BulkActionBar
          count={selected.size}
          onClear={clear}
          actions={[
            ...(canManageCustomers ? [{
              label: bulkWorking ? "Working…" : "Suspend",
              icon: <UserX className="w-3.5 h-3.5" />,
              className: "text-orange-600 border-orange-200 hover:bg-orange-50",
              onClick: () => void handleBulkStatus("suspended"),
            }, {
              label: bulkWorking ? "Working…" : "Reactivate",
              icon: <UserCheck className="w-3.5 h-3.5" />,
              className: "text-green-600 border-green-200 hover:bg-green-50",
              onClick: () => void handleBulkStatus("active"),
            }] : []),
            ...(canDeleteCustomers ? [{
              label: bulkWorking ? "Working…" : "Delete",
              icon: <Trash2 className="w-3.5 h-3.5" />,
              className: "text-red-600 border-red-200 hover:bg-red-50",
              onClick: () => void handleBulkDelete(),
            }] : []),
          ]}
        />

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-10 pl-4">
                  <Checkbox
                    checked={isAllSelected ? true : isIndeterminate ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-[280px]">Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-red-500">
                    <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-60" />
                    <p className="text-sm font-medium">Couldn't load customers</p>
                    <p className="text-xs text-gray-500 mt-0.5">{(error as any)?.message ?? "Request failed. Your data is safe — this is a connection issue, not data loss."}</p>
                    <Button variant="link" size="sm" className="mt-1 text-blue-600" onClick={() => refetch()}>
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ) : isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {[40, 300, 180, 80, 100, 40].map((w, j) => (
                    <TableCell key={j}><Skeleton className={`h-8 ${j === 0 ? "w-4" : j === 5 ? "w-8 ml-auto" : "w-full"}`} /></TableCell>
                  ))}
                </TableRow>
              )) : customers.length > 0 ? (
                customers.map(customer => (
                  <TableRow key={customer.id} className={`hover:bg-gray-50/50 ${selected.has(customer.id) ? "bg-blue-50/40" : ""}`}>
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(customer.id)}
                        onCheckedChange={() => toggle(customer.id)}
                        aria-label={`Select ${customer.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <Link href={`/customers/${customer.id}`} className="font-medium text-gray-900 hover:text-blue-600 hover:underline">
                            {customer.name}
                          </Link>
                          <div className="flex items-center text-xs text-gray-400 mt-0.5">
                            <MapPin className={`w-3 h-3 mr-1 ${(customer as any).latitude ? "text-green-500" : ""}`} />
                            <span className="truncate max-w-[180px]">{customer.address}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="flex items-center text-sm text-gray-600"><Mail className="w-3.5 h-3.5 mr-2 text-gray-400" />{customer.email}</div>
                        <div className="flex items-center text-sm text-gray-600"><Phone className="w-3.5 h-3.5 mr-2 text-gray-400" />{customer.phone}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${STATUS_COLORS[customer.status] ?? ""} border-0`}>
                        {customer.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{formatDate(customer.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild><Link href={`/customers/${customer.id}`}>View Details</Link></DropdownMenuItem>
                          {canManageCustomers && (
                            <DropdownMenuItem onClick={() => setDialog({
                              open: true, id: customer.id,
                              initial: {
                                name: customer.name, email: customer.email, phone: customer.phone,
                                address: customer.address, status: customer.status, notes: customer.notes ?? "",
                                latitude:  (customer as any).latitude  != null ? String((customer as any).latitude)  : "",
                                longitude: (customer as any).longitude != null ? String((customer as any).longitude) : "",
                                pppoeUsername: (customer as any).pppoeUsername ?? "",
                                pppoePassword: (customer as any).pppoePassword ?? "",
                              },
                            })}>
                              <Pencil className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                          )}
                          {canManageCustomers && (
                            <>
                              <DropdownMenuSeparator />
                              {customer.status === "active" ? (
                                <DropdownMenuItem className="text-orange-600" onClick={() => handleStatusChange(customer.id, "suspended")}>
                                  <UserX className="w-4 h-4 mr-2" /> Suspend
                                </DropdownMenuItem>
                              ) : customer.status === "suspended" ? (
                                <DropdownMenuItem className="text-green-600" onClick={() => handleStatusChange(customer.id, "active")}>
                                  <UserCheck className="w-4 h-4 mr-2" /> Reactivate
                                </DropdownMenuItem>
                              ) : null}
                            </>
                          )}
                          {canDeleteCustomers && (
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(customer.id, customer.name)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={6} className="h-24 text-center text-gray-500">No customers found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CustomerDialog
        key={dialog.open ? (dialog.id ?? "new") : "closed"}
        open={dialog.open}
        onClose={() => setDialog({ open: false })}
        initial={dialog.initial}
        customerId={dialog.id}
      />

      <AlertDialog open={!!deleteConfirm?.open} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteConfirm?.label}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-gray-600">
                <p>This cannot be undone.</p>
                {deleteConfirm?.loadingRouters ? (
                  <p className="text-gray-400">Checking for assigned routers…</p>
                ) : (() => {
                  const allRouters = [...(deleteConfirm?.routersByCustomer.values() ?? [])].flat();
                  if (allRouters.length === 0) return null;
                  return (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                      <p className="flex items-center gap-1.5 font-medium text-amber-800">
                        <AlertTriangle className="w-4 h-4" /> {allRouters.length} router{allRouters.length === 1 ? "" : "s"} will also be deleted
                      </p>
                      <ul className="mt-1.5 list-disc pl-5 text-amber-700">
                        {allRouters.map(r => <li key={r.id}>{r.name}</li>)}
                      </ul>
                    </div>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmDelete(); }}
              disabled={bulkWorking}
              className="bg-red-600 hover:bg-red-700"
            >
              {bulkWorking ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
