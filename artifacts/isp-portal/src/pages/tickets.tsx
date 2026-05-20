import { useState } from "react";
import { Link } from "wouter";
import {
  useListTickets, useCreateTicket, useUpdateTicket, useDeleteTicket,
  useListCustomers,
  type TicketInput, type TicketUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Filter, Pencil, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/formatDate";

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 border-red-200",
  high: "bg-orange-100 text-orange-700 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-gray-100 text-gray-700 border-gray-200",
};
const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-purple-100 text-purple-700 border-purple-200",
  resolved: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-gray-100 text-gray-700 border-gray-200",
};

type TicketForm = { customerId: string; subject: string; description: string; priority: string; status: string; category: string; assignedTo: string };
const EMPTY: TicketForm = { customerId: "", subject: "", description: "", priority: "medium", status: "open", category: "", assignedTo: "" };

function TicketDialog({ open, onClose, initial, ticketId }: {
  open: boolean; onClose: () => void; initial?: TicketForm; ticketId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreateTicket();
  const updateMutation = useUpdateTicket();
  const { data: customers } = useListCustomers({ limit: 200 });
  const [form, setForm] = useState<TicketForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof TicketForm, v: string) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (ticketId) {
        const upd: TicketUpdate = {
          subject: form.subject || undefined,
          status: form.status as TicketUpdate["status"],
          priority: form.priority as TicketUpdate["priority"],
          category: form.category || null,
          assignedTo: form.assignedTo || null,
        };
        await updateMutation.mutateAsync({ id: ticketId, data: upd });
      } else {
        const inp: TicketInput = {
          customerId: Number(form.customerId),
          subject: form.subject,
          description: form.description,
          priority: form.priority as TicketInput["priority"],
          status: form.status as TicketInput["status"],
          category: form.category || undefined,
          assignedTo: form.assignedTo || undefined,
        };
        await createMutation.mutateAsync({ data: inp });
      }
      await qc.invalidateQueries({ queryKey: ["/api/tickets"] });
      onClose();
    } finally { setSaving(false); }
  };

  const valid = ticketId ? (form.subject && form.status) : (form.customerId && form.subject && form.description);

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{ticketId ? "Edit Ticket" : "Create Ticket"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!ticketId && (
            <div className="space-y-1"><Label>Customer *</Label>
              <Select value={form.customerId} onValueChange={v => set("customerId", v)}>
                <SelectTrigger><SelectValue placeholder="Select customer…" /></SelectTrigger>
                <SelectContent>
                  {customers?.data?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1"><Label>Subject *</Label>
            <Input value={form.subject} onChange={e => set("subject", e.target.value)} placeholder="Internet not working" />
          </div>
          {!ticketId && (
            <div className="space-y-1"><Label>Description *</Label>
              <Textarea rows={3} className="resize-none" value={form.description} onChange={e => set("description", e.target.value)} placeholder="Describe the issue in detail…" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Priority</Label>
              <Select value={form.priority} onValueChange={v => set("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Status</Label>
              <Select value={form.status} onValueChange={v => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Category</Label>
              <Input value={form.category} onChange={e => set("category", e.target.value)} placeholder="connectivity" />
            </div>
            <div className="space-y-1"><Label>Assigned To</Label>
              <Input value={form.assignedTo} onChange={e => set("assignedTo", e.target.value)} placeholder="tech@isp.co.ke" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : ticketId ? "Update Ticket" : "Create Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Tickets() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: ticketsData, isLoading } = useListTickets(statusFilter ? { status: statusFilter } : {});
  const deleteMutation = useDeleteTicket();
  const updateMutation = useUpdateTicket();
  const [dialog, setDialog] = useState<{ open: boolean; id?: number; initial?: TicketForm }>({ open: false });

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this ticket?")) return;
    await deleteMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/tickets"] });
  };

  const handleQuickStatus = async (id: number, status: string) => {
    await updateMutation.mutateAsync({ id, data: { status } as TicketUpdate });
    qc.invalidateQueries({ queryKey: ["/api/tickets"] });
  };

  const tickets = (ticketsData as any)?.data ?? ticketsData ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Support Tickets</h1>
          <p className="text-gray-500 text-sm">Manage customer support requests and issues.</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialog({ open: true })}>
          <Plus className="w-4 h-4 mr-2" /> Create Ticket
        </Button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex flex-wrap gap-2">
          <div className="flex items-center text-sm text-gray-500 mr-2"><Filter className="w-4 h-4 mr-2" /> Filter:</div>
          {["all", "open", "in_progress", "resolved", "closed"].map(status => (
            <Button key={status} variant={statusFilter === status || (status === "all" && !statusFilter) ? "default" : "outline"} size="sm"
              onClick={() => setStatusFilter(status === "all" ? undefined : status)}
              className={statusFilter === status || (status === "all" && !statusFilter) ? "bg-blue-600" : "bg-white"}>
              {status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1)}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-[90px]">ID</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              )) : Array.isArray(tickets) && tickets.length > 0 ? (
                tickets.map((ticket: any) => (
                  <TableRow key={ticket.id} className="hover:bg-gray-50/50">
                    <TableCell className="font-mono text-sm text-gray-500">
                      <Link href={`/tickets/${ticket.id}`} className="hover:text-blue-600">#{String(ticket.id).padStart(5, "0")}</Link>
                    </TableCell>
                    <TableCell className="font-medium text-gray-900 max-w-xs">
                      <Link href={`/tickets/${ticket.id}`} className="hover:text-blue-600 block truncate">{ticket.subject}</Link>
                    </TableCell>
                    <TableCell>
                      {ticket.customer
                        ? <Link href={`/customers/${ticket.customerId}`} className="text-gray-600 hover:text-blue-600 hover:underline">{ticket.customer.name}</Link>
                        : `Customer #${ticket.customerId}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${PRIORITY_COLORS[ticket.priority] ?? ""}`}>{ticket.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Select value={ticket.status} onValueChange={v => handleQuickStatus(ticket.id, v)}>
                        <SelectTrigger className={`h-7 w-32 text-xs border px-2 ${STATUS_COLORS[ticket.status] ?? ""}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">{formatDate(ticket.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" asChild>
                          <Link href={`/tickets/${ticket.id}`}><MessageSquare className="w-3.5 h-3.5" /></Link>
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-blue-600"
                          onClick={() => setDialog({ open: true, id: ticket.id, initial: {
                            customerId: String(ticket.customerId), subject: ticket.subject,
                            description: ticket.description ?? "", priority: ticket.priority,
                            status: ticket.status, category: ticket.category ?? "", assignedTo: ticket.assignedTo ?? "",
                          }})}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-500 hover:text-red-600" onClick={() => handleDelete(ticket.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-gray-500">No tickets found.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <TicketDialog open={dialog.open} onClose={() => setDialog({ open: false })} initial={dialog.initial} ticketId={dialog.id} />
    </div>
  );
}
