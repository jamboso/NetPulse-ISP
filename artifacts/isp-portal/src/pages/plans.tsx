import { useState } from "react";
import {
  useListPlans, useCreatePlan, useUpdatePlan, useDeletePlan,
  type PlanInput, type PlanUpdate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useBulkSelect } from "@/hooks/useBulkSelect";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Plus, Wifi, Zap, Pencil, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

type PlanForm = { name: string; description: string; downloadSpeed: string; uploadSpeed: string; price: string; billingCycle: string; isActive: boolean; rosProfileName: string };
const EMPTY: PlanForm = { name: "", description: "", downloadSpeed: "", uploadSpeed: "", price: "", billingCycle: "monthly", isActive: true, rosProfileName: "" };

function PlanDialog({ open, onClose, initial, planId }: {
  open: boolean; onClose: () => void; initial?: PlanForm; planId?: number;
}) {
  const qc = useQueryClient();
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const [form, setForm] = useState<PlanForm>(initial ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof PlanForm, v: string | boolean) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || undefined,
        downloadSpeed: Number(form.downloadSpeed),
        uploadSpeed: Number(form.uploadSpeed),
        price: Number(form.price),
        billingCycle: form.billingCycle as PlanInput["billingCycle"],
        isActive: form.isActive,
        rosProfileName: form.rosProfileName || undefined,
      };
      if (planId) {
        await updateMutation.mutateAsync({ id: planId, data: payload as PlanUpdate });
      } else {
        await createMutation.mutateAsync({ data: payload as PlanInput });
      }
      await qc.invalidateQueries({ queryKey: ["/api/plans"] });
      onClose();
    } finally { setSaving(false); }
  };

  const valid = form.name && form.downloadSpeed && form.uploadSpeed && form.price;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{planId ? "Edit Plan" : "Create Plan"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Plan Name *</Label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Basic Home 10Mbps" />
          </div>
          <div className="space-y-1"><Label>Description</Label>
            <Textarea rows={2} className="resize-none" value={form.description} onChange={e => set("description", e.target.value)} placeholder="Suitable for light browsing and streaming" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Download (Mbps) *</Label>
              <Input type="number" value={form.downloadSpeed} onChange={e => set("downloadSpeed", e.target.value)} placeholder="10" />
            </div>
            <div className="space-y-1"><Label>Upload (Mbps) *</Label>
              <Input type="number" value={form.uploadSpeed} onChange={e => set("uploadSpeed", e.target.value)} placeholder="5" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Price *</Label>
              <Input type="number" value={form.price} onChange={e => set("price", e.target.value)} placeholder="1500" />
            </div>
            <div className="space-y-1"><Label>Billing Cycle</Label>
              <Select value={form.billingCycle} onValueChange={v => set("billingCycle", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>RouterOS Profile Name</Label>
            <Input value={form.rosProfileName} onChange={e => set("rosProfileName", e.target.value)} placeholder="e.g. plan-5mbps (leave blank for default)" />
            <p className="text-xs text-gray-400">Maps to a PPP profile on RouterOS for speed limiting</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.isActive} onCheckedChange={v => set("isActive", v)} id="isActive" />
            <Label htmlFor="isActive" className="cursor-pointer text-sm">Active (available for subscriptions)</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !valid} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? "Saving…" : planId ? "Update Plan" : "Create Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Plans() {
  const qc = useQueryClient();
  const { data: plans, isLoading } = useListPlans();
  const deleteMutation = useDeletePlan();
  const updateMutation = useUpdatePlan();
  const { isAdmin } = useCurrentUser();
  const [dialog, setDialog] = useState<{ open: boolean; id?: number; initial?: PlanForm }>({ open: false });
  const [bulkWorking, setBulkWorking] = useState(false);

  const planList = plans ?? [];
  const ids = planList.map(p => p.id);
  const { selected, toggle, toggleAll, clear, isAllSelected, isIndeterminate } = useBulkSelect(ids);

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete plan "${name}"?`)) return;
    await deleteMutation.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: ["/api/plans"] });
  };

  const handleToggleActive = async (id: number, isActive: boolean) => {
    await updateMutation.mutateAsync({ id, data: { isActive: !isActive } as PlanUpdate });
    qc.invalidateQueries({ queryKey: ["/api/plans"] });
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} plan(s)?`)) return;
    setBulkWorking(true);
    try {
      await Promise.all([...selected].map(id => deleteMutation.mutateAsync({ id })));
      clear();
      qc.invalidateQueries({ queryKey: ["/api/plans"] });
    } finally { setBulkWorking(false); }
  };

  const handleBulkSetActive = async (isActive: boolean) => {
    setBulkWorking(true);
    try {
      await Promise.all([...selected].map(id =>
        updateMutation.mutateAsync({ id, data: { isActive } as PlanUpdate })
      ));
      clear();
      qc.invalidateQueries({ queryKey: ["/api/plans"] });
    } finally { setBulkWorking(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Service Plans</h1>
          <p className="text-gray-500 text-sm">Manage internet packages and pricing tiers.</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && selected.size > 0 && (
            <BulkActionBar
              count={selected.size}
              onClear={clear}
              actions={[
                {
                  label: bulkWorking ? "Working…" : "Activate",
                  icon: <ToggleRight className="w-3.5 h-3.5" />,
                  className: "text-green-600 border-green-200 hover:bg-green-50",
                  onClick: () => void handleBulkSetActive(true),
                },
                {
                  label: bulkWorking ? "Working…" : "Deactivate",
                  icon: <ToggleLeft className="w-3.5 h-3.5" />,
                  className: "text-orange-600 border-orange-200 hover:bg-orange-50",
                  onClick: () => void handleBulkSetActive(false),
                },
                {
                  label: bulkWorking ? "Working…" : "Delete",
                  icon: <Trash2 className="w-3.5 h-3.5" />,
                  className: "text-red-600 border-red-200 hover:bg-red-50",
                  onClick: () => void handleBulkDelete(),
                },
              ]}
            />
          )}
          {isAdmin && (
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setDialog({ open: true })}>
              <Plus className="w-4 h-4 mr-2" /> Create Plan
            </Button>
          )}
        </div>
      </div>

      {isAdmin && planList.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Checkbox
            checked={isAllSelected ? true : isIndeterminate ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            id="select-all-plans"
          />
          <label htmlFor="select-all-plans" className="cursor-pointer select-none">
            {isAllSelected ? "Deselect all" : "Select all plans"}
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <Skeleton className="h-8 w-1/2 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-3/4 mb-6" />
            <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          </div>
        )) : planList.length > 0 ? (
          planList.map(plan => (
            <div
              key={plan.id}
              className={`bg-white rounded-xl border overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col ${
                selected.has(plan.id) ? "border-blue-400 ring-2 ring-blue-100" : "border-gray-200"
              }`}
            >
              <div className="p-5 flex-1">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {isAdmin && (
                      <Checkbox
                        checked={selected.has(plan.id)}
                        onCheckedChange={() => toggle(plan.id)}
                        aria-label={`Select ${plan.name}`}
                        className="mt-0.5"
                      />
                    )}
                    <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                  </div>
                  <Badge variant="outline" className={plan.isActive ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-500 border-gray-200"}>
                    {plan.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 mb-4 min-h-[2.5rem] line-clamp-2 pl-6">{plan.description || "No description."}</p>
                <div className="flex items-baseline gap-1 mb-4 pl-6">
                  <span className="text-3xl font-bold text-gray-900">${plan.price.toFixed(2)}</span>
                  <span className="text-sm text-gray-500">/{plan.billingCycle}</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center text-sm bg-blue-50/60 p-2.5 rounded-lg border border-blue-100">
                    <Zap className="w-4 h-4 text-blue-600 mr-2.5" />
                    <span className="text-gray-500 w-20">Download</span>
                    <span className="text-blue-900 font-bold">{plan.downloadSpeed} Mbps</span>
                  </div>
                  <div className="flex items-center text-sm bg-green-50/60 p-2.5 rounded-lg border border-green-100">
                    <Wifi className="w-4 h-4 text-green-600 mr-2.5" />
                    <span className="text-gray-500 w-20">Upload</span>
                    <span className="text-green-900 font-bold">{plan.uploadSpeed} Mbps</span>
                  </div>
                </div>
              </div>
              {isAdmin && (
                <div className="p-3 bg-gray-50 border-t border-gray-100 flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1 bg-white"
                    onClick={() => setDialog({ open: true, id: plan.id, initial: {
                      name: plan.name, description: plan.description ?? "",
                      downloadSpeed: String(plan.downloadSpeed), uploadSpeed: String(plan.uploadSpeed),
                      price: String(plan.price), billingCycle: plan.billingCycle, isActive: plan.isActive,
                      rosProfileName: (plan as any).rosProfileName ?? "",
                    }})}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-gray-500 hover:text-orange-600 px-2"
                    title={plan.isActive ? "Deactivate" : "Activate"}
                    onClick={() => handleToggleActive(plan.id, plan.isActive)}>
                    {plan.isActive ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-gray-500 hover:text-red-600 px-2"
                    onClick={() => handleDelete(plan.id, plan.name)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-gray-500 bg-white rounded-lg border border-gray-200 border-dashed">
            No service plans yet.{" "}
            <button className="text-blue-600 underline" onClick={() => setDialog({ open: true })}>Create one →</button>
          </div>
        )}
      </div>

      <PlanDialog open={dialog.open} onClose={() => setDialog({ open: false })} initial={dialog.initial} planId={dialog.id} />
    </div>
  );
}
