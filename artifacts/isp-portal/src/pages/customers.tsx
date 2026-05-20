import { useState } from "react";
import { Link } from "wouter";
import {
  useListCustomers, useCreateCustomer, useUpdateCustomer, useDeleteCustomer,
  type CustomerInput, type CustomerUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, MoreHorizontal, Mail, Phone, MapPin, Pencil, Trash2, UserX, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { format } from "date-fns";

type CustomerForm = { name: string; email: string; phone: string; address: string; status: string; notes: string };
const EMPTY: CustomerForm = { name: "", email: "", phone: "", address: "", status: "active", notes: "" };

function CustomerDialog({ open, onClose, initial, customerId }: {
  open: boolean; onClose: () => void; initial?: CustomerForm; customerId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const [form, setForm] = useState<CustomerForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof CustomerForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (customerId) {
        await updateMutation.mutateAsync({ id: customerId, data: { ...form } as CustomerUpdate });
      } else {
        await createMutation.mutateAsync({ data: { ...form } as CustomerInput });
      }
      await qc.invalidateQueries({ queryKey: ["/api/customers"] });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{customerId ? "Edit Customer" : "Add Customer"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Full Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="John Doe" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Email *</Label>
              <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="john@example.com" />
            </div>
            <div className="space-y-1"><Label>Phone *</Label>
              <Input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+254 700 000 000" />
            </div>
          </div>
          <div className="space-y-1"><Label>Address *</Label>
            <Textarea rows={2} className="resize-none" value={form.address} onChange={e => set("address", e.target.value)} placeholder="123 Main St, Nairobi" />
          </div>
          <div className="space-y-1"><Label>Status</Label>
            <Select value={form.status} onValueChange={v => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="terminated">Terminated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Notes</Label>
            <Textarea rows={2} className="resize-none" value={form.notes} onChange={e => set("notes", e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.name || !form.email || !form.phone || !form.address}
            className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : customerId ? "Update" : "Add Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700 hover:bg-green-100",
  suspended: "bg-orange-100 text-orange-700 hover:bg-orange-100",
  terminated: "bg-red-100 text-red-700 hover:bg-red-100",
};

export default function Customers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: customersData, isLoading } = useListCustomers({ search, limit: 50 });
  const deleteMutation = useDeleteCustomer();
  const updateMutation = useUpdateCustomer();

  const [dialog, setDialog] = useState<{ open: boolean; id?: number; initial?: CustomerForm }>({ open: false });

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete customer "${name}"? This cannot be undone.`)) return;
    await deleteMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/customers"] });
  };

  const handleStatusChange = async (id: number, status: string) => {
    await updateMutation.mutateAsync({ id, data: { status } as CustomerUpdate });
    qc.invalidateQueries({ queryKey: ["/api/customers"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Customers</h1>
          <p className="text-gray-500 text-sm">Manage your customer base and their accounts.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialog({ open: true })}>
          <Plus className="w-4 h-4 mr-2" /> Add Customer
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input placeholder="Search by name, email, or phone…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-gray-50 border-gray-200 focus-visible:ring-blue-500" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-[300px]">Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {[300, 180, 80, 100, 40].map((w, j) => (
                    <TableCell key={j}><Skeleton className={`h-8 w-${w === 40 ? "8 ml-auto" : "full"}`} /></TableCell>
                  ))}
                </TableRow>
              )) : customersData?.data && customersData.data.length > 0 ? (
                customersData.data.map(customer => (
                  <TableRow key={customer.id} className="hover:bg-gray-50/50">
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
                            <MapPin className="w-3 h-3 mr-1" />
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
                    <TableCell className="text-sm text-gray-600">{format(new Date(customer.createdAt), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild><Link href={`/customers/${customer.id}`}>View Details</Link></DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDialog({
                            open: true, id: customer.id,
                            initial: { name: customer.name, email: customer.email, phone: customer.phone,
                              address: customer.address, status: customer.status, notes: customer.notes ?? "" },
                          })}>
                            <Pencil className="w-4 h-4 mr-2" /> Edit
                          </DropdownMenuItem>
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
                          <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(customer.id, customer.name)}>
                            <Trash2 className="w-4 h-4 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={5} className="h-24 text-center text-gray-500">No customers found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CustomerDialog open={dialog.open} onClose={() => setDialog({ open: false })} initial={dialog.initial} customerId={dialog.id} />
    </div>
  );
}
