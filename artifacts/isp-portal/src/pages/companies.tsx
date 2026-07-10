import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Clock, Ban, PlayCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface Company {
  id: number;
  name: string;
  username: string;
  ownerEmail: string;
  ownerPhone: string | null;
  accessStatus: "active" | "suspended";
  accessUntil: string | null;
  exempt: boolean;
  createdAt: string;
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const COMPANIES_KEY = ["companies"];

function daysRemainingLabel(c: Company): string {
  if (c.exempt) return "—";
  if (!c.accessUntil) return "—";
  const diffMs = new Date(c.accessUntil).getTime() - Date.now();
  if (diffMs <= 0) return c.accessStatus === "suspended" ? "Expired" : "Expiring";
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return `${days} day${days !== 1 ? "s" : ""}`;
}

export default function Companies() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [extendTarget, setExtendTarget] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: "", ownerEmail: "", ownerPhone: "" });
  const [extendForm, setExtendForm] = useState({ amount: "1", unit: "months" });

  const { data, isLoading } = useQuery({
    queryKey: COMPANIES_KEY,
    queryFn: () => apiJson<{ data: Company[] }>("/api/companies"),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: COMPANIES_KEY });

  const createMutation = useMutation({
    mutationFn: () =>
      apiJson<Company & { tempPassword: string }>("/api/companies", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          ownerEmail: form.ownerEmail,
          ownerPhone: form.ownerPhone || null,
        }),
      }),
    onSuccess: (created) => {
      invalidate();
      setCreateOpen(false);
      setForm({ name: "", ownerEmail: "", ownerPhone: "" });
      toast({
        title: "Company created",
        description: `Username: ${created.username} · Temp password: ${created.tempPassword}`,
      });
    },
    onError: (err: Error) => toast({ title: "Failed to create company", description: err.message, variant: "destructive" }),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: number) => apiJson(`/api/companies/${id}/suspend`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: (id: number) => apiJson(`/api/companies/${id}/activate`, { method: "POST" }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const exemptMutation = useMutation({
    mutationFn: ({ id, exempt }: { id: number; exempt: boolean }) =>
      apiJson(`/api/companies/${id}/exempt`, { method: "POST", body: JSON.stringify({ exempt }) }),
    onSuccess: invalidate,
    onError: (err: Error) => toast({ title: "Action failed", description: err.message, variant: "destructive" }),
  });

  const extendMutation = useMutation({
    mutationFn: () =>
      apiJson(`/api/companies/${extendTarget!.id}/extend`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(extendForm.amount), unit: extendForm.unit }),
      }),
    onSuccess: () => {
      invalidate();
      setExtendTarget(null);
    },
    onError: (err: Error) => toast({ title: "Failed to extend access", description: err.message, variant: "destructive" }),
  });

  const companies = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="w-6 h-6" /> Companies</h1>
          <p className="text-sm text-muted-foreground">Manage tenant accounts, access, and billing status.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-2" /> New Company</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>All Companies</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Owner Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Access Until</TableHead>
                  <TableHead>Days Remaining</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.username}</TableCell>
                    <TableCell>{c.ownerEmail}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Badge variant={c.accessStatus === "active" ? "default" : "destructive"}>{c.accessStatus}</Badge>
                        {c.exempt && <Badge variant="outline">exempt</Badge>}
                      </div>
                    </TableCell>
                    <TableCell>{c.accessUntil ? new Date(c.accessUntil).toLocaleString() : "—"}</TableCell>
                    <TableCell>{daysRemainingLabel(c)}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="outline" onClick={() => setExtendTarget(c)}>
                        <Clock className="w-3.5 h-3.5 mr-1" /> Extend
                      </Button>
                      {c.accessStatus === "active" ? (
                        <Button size="sm" variant="outline" onClick={() => suspendMutation.mutate(c.id)}>
                          <Ban className="w-3.5 h-3.5 mr-1" /> Suspend
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => activateMutation.mutate(c.id)}>
                          <PlayCircle className="w-3.5 h-3.5 mr-1" /> Activate
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => exemptMutation.mutate({ id: c.id, exempt: !c.exempt })}>
                        <ShieldCheck className="w-3.5 h-3.5 mr-1" /> {c.exempt ? "Unexempt" : "Exempt"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {companies.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No companies yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Company</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Company Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Owner Email</Label>
              <Input type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
            </div>
            <div>
              <Label>Owner Phone (optional)</Label>
              <Input value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!form.name || !form.ownerEmail || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extendTarget} onOpenChange={(open) => !open && setExtendTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Extend Access — {extendTarget?.name}</DialogTitle></DialogHeader>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label>Amount</Label>
              <Input type="number" min={1} value={extendForm.amount} onChange={(e) => setExtendForm({ ...extendForm, amount: e.target.value })} />
            </div>
            <div className="flex-1">
              <Label>Unit</Label>
              <Select value={extendForm.unit} onValueChange={(v) => setExtendForm({ ...extendForm, unit: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                  <SelectItem value="months">Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendTarget(null)}>Cancel</Button>
            <Button disabled={extendMutation.isPending} onClick={() => extendMutation.mutate()}>Extend</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
