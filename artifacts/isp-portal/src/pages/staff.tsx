import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useGetWelcomeEmailPreview,
  useSendWelcomeEmailTest,
  getListUsersQueryKey,
  getGetWelcomeEmailPreviewQueryKey,
} from "@workspace/api-client-react";
import type { StaffUser } from "@workspace/api-client-react";
import { useBulkSelect } from "@/hooks/useBulkSelect";
import { BulkActionBar } from "@/components/BulkActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserCog, Plus, MoreHorizontal, Search, MessageSquare, Mail, BellOff, UserX, UserCheck, ShieldCheck, ChevronDown, ChevronUp, Check, X, AlertTriangle, Clock, Eye, Send, WifiOff } from "lucide-react";

const ROLES = ["admin", "billing", "support", "technician"] as const;

type PermissionArea = {
  label: string;
  admin: boolean;
  billing: boolean;
  support: boolean;
  technician: boolean;
};

const PERMISSION_AREAS: PermissionArea[] = [
  { label: "Customers (view & edit)",  admin: true,  billing: true,  support: true,  technician: false },
  { label: "Service Plans",            admin: true,  billing: false, support: false, technician: false },
  { label: "Subscriptions",            admin: true,  billing: true,  support: false, technician: false },
  { label: "Invoices & Payments",      admin: true,  billing: true,  support: false, technician: false },
  { label: "Support Tickets",          admin: true,  billing: false, support: true,  technician: false },
  { label: "Network Equipment",        admin: true,  billing: false, support: false, technician: true  },
  { label: "IP Pools",                 admin: true,  billing: false, support: false, technician: true  },
  { label: "Staff Management",         admin: true,  billing: false, support: false, technician: false },
  { label: "Settings",                 admin: true,  billing: false, support: false, technician: false },
];

const roleDescription: Record<Role, string> = {
  admin:      "Full access to all areas of the system including staff and settings.",
  billing:    "Manages customers, subscriptions, invoices, and payments.",
  support:    "Handles customer inquiries and support tickets.",
  technician: "Manages network equipment and IP pool assignments.",
};

function PermissionCell({ allowed }: { allowed: boolean }) {
  return allowed
    ? <Check className="w-4 h-4 text-green-600 mx-auto" />
    : <X className="w-4 h-4 text-gray-300 mx-auto" />;
}

function RolePermissionsMatrix() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-blue-100 bg-blue-50/40">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-blue-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            Role Permissions Reference
          </CardTitle>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-xs text-blue-600 flex items-center gap-1 hover:underline focus:outline-none"
          >
            {open ? "Hide" : "Show"} matrix
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
        {!open && (
          <p className="text-xs text-blue-700 mt-1">
            Admin: full access · Billing: invoices/payments/subscriptions · Support: customers/tickets · Technician: equipment/IP pools
          </p>
        )}
      </CardHeader>
      {open && (
        <CardContent className="px-4 pb-4">
          <div className="rounded-md border border-blue-100 overflow-hidden bg-white">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-gray-500 font-medium w-1/2">Area</th>
                  {ROLES.map(r => (
                    <th key={r} className="text-center py-2 px-2 font-semibold">
                      <RoleBadge role={r} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_AREAS.map((area, i) => (
                  <tr key={area.label} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                    <td className="py-2 px-3 text-gray-700">{area.label}</td>
                    <td className="py-2 px-2 text-center"><PermissionCell allowed={area.admin} /></td>
                    <td className="py-2 px-2 text-center"><PermissionCell allowed={area.billing} /></td>
                    <td className="py-2 px-2 text-center"><PermissionCell allowed={area.support} /></td>
                    <td className="py-2 px-2 text-center"><PermissionCell allowed={area.technician} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function RoleInlineSummary({ role }: { role: Role }) {
  const areas = PERMISSION_AREAS.filter(a => a[role]);
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2 mt-1">
      <p className="text-xs text-gray-600 mb-1.5 font-medium">{roleDescription[role]}</p>
      <div className="flex flex-wrap gap-1">
        {areas.map(a => (
          <span key={a.label} className="inline-flex items-center gap-0.5 text-xs bg-white border border-gray-200 text-gray-600 rounded px-1.5 py-0.5">
            <Check className="w-3 h-3 text-green-500 shrink-0" />
            {a.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "Never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function isInactive(dateStr: string | null | undefined): boolean {
  if (!dateStr) return true;
  const days = (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
  return days > 30;
}

function getInactiveDays(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function InactivityBadge({
  lastActiveAt,
  isActive,
  onDeactivate,
}: {
  lastActiveAt: string | null | undefined;
  isActive: boolean;
  onDeactivate: () => void;
}) {
  const days = getInactiveDays(lastActiveAt);
  const neverLoggedIn = !lastActiveAt;
  const stale = neverLoggedIn || (days !== null && days > 30);

  if (!stale) return null;

  if (neverLoggedIn) {
    return (
      <button
        type="button"
        onClick={isActive ? onDeactivate : undefined}
        title={isActive ? "Click to deactivate this account" : "Account already deactivated"}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border
          bg-red-100 text-red-700 border-red-200
          ${isActive ? "cursor-pointer hover:bg-red-200 transition-colors" : "cursor-default opacity-70"}`}
      >
        <Clock className="w-3 h-3 shrink-0" />
        Never logged in
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={isActive ? onDeactivate : undefined}
      title={isActive ? "Click to deactivate this account" : "Account already deactivated"}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border
        bg-amber-100 text-amber-700 border-amber-200
        ${isActive ? "cursor-pointer hover:bg-amber-200 transition-colors" : "cursor-default opacity-70"}`}
    >
      <AlertTriangle className="w-3 h-3 shrink-0" />
      Inactive {days}d
    </button>
  );
}

type Role = (typeof ROLES)[number];

const roleBadgeColor: Record<Role, string> = {
  admin: "bg-purple-100 text-purple-800 border-purple-200",
  billing: "bg-blue-100 text-blue-800 border-blue-200",
  support: "bg-green-100 text-green-800 border-green-200",
  technician: "bg-orange-100 text-orange-800 border-orange-200",
};

const roleLabel: Record<Role, string> = {
  admin: "Admin",
  billing: "Billing",
  support: "Support",
  technician: "Technician",
};

function RoleBadge({ role }: { role: string }) {
  const r = role as Role;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${roleBadgeColor[r] ?? "bg-gray-100 text-gray-800 border-gray-200"}`}>
      {roleLabel[r] ?? role}
    </span>
  );
}

export default function StaffPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editUser, setEditUser] = useState<StaffUser | null>(null);
  const [editRole, setEditRole] = useState<Role>("admin");
  const [formError, setFormError] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testSendStatus, setTestSendStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("support");
  const [newAccountPhone, setNewAccountPhone] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [notifyMethod, setNotifyMethod] = useState<"none" | "sms" | "email" | "both">("none");
  const [editPhone, setEditPhone] = useState("");

  const previewQuery = useGetWelcomeEmailPreview({
    query: { queryKey: getGetWelcomeEmailPreviewQueryKey(), enabled: previewOpen, staleTime: 30_000 },
  });

  const sendTestMutation = useSendWelcomeEmailTest({
    mutation: {
      onSuccess: (data) => {
        setTestSendStatus({ type: "success", message: data.message });
      },
      onError: async (err) => {
        try {
          const resp = (err as { response?: Response }).response;
          if (resp) {
            const j = (await resp.json()) as { error?: string };
            setTestSendStatus({ type: "error", message: j.error ?? "Failed to send test email" });
            return;
          }
        } catch { /* ignore */ }
        setTestSendStatus({ type: "error", message: "Failed to send test email" });
      },
    },
  });

  const { data, isLoading } = useListUsers({ search: search || undefined });
  const users = data?.data ?? [];

  const ids = users.map(u => u.id);
  const { selected, toggle, toggleAll, clear, isAllSelected, isIndeterminate } = useBulkSelect(ids);

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setInviteOpen(false);
        resetInviteForm();
      },
      onError: async (err) => {
        const msg = await extractError(err);
        setFormError(msg);
      },
    },
  });

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        setEditUser(null);
      },
      onError: async (err) => {
        const msg = await extractError(err);
        setFormError(msg);
      },
    },
  });

  async function extractError(err: unknown): Promise<string> {
    try {
      const resp = (err as { response?: Response }).response;
      if (resp) {
        const j = (await resp.json()) as { error?: string };
        return j.error ?? "An error occurred";
      }
    } catch { /* ignore */ }
    return "An unexpected error occurred";
  }

  function resetInviteForm() {
    setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("support");
    setNewAccountPhone(""); setNewPhone(""); setNotifyMethod("none"); setFormError("");
  }

  function handleInviteOpen() { resetInviteForm(); setInviteOpen(true); }

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if ((notifyMethod === "sms" || notifyMethod === "both") && !newPhone.trim()) {
      setFormError("Phone number is required when SMS notification is selected.");
      return;
    }
    createMutation.mutate({
      data: {
        name: newName, email: newEmail, password: newPassword, role: newRole,
        notifyMethod,
        ...(newAccountPhone.trim() ? { phone: newAccountPhone.trim() } : {}),
        ...(newPhone.trim() ? { notifyPhone: newPhone.trim() } : {}),
      },
    });
  }

  function handleEditOpen(user: StaffUser) {
    setFormError(""); setEditRole(user.role as Role); setEditPhone(user.phone ?? ""); setEditUser(user);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setFormError("");
    updateMutation.mutate({
      id: editUser.id,
      data: { role: editRole, phone: editPhone.trim() || null },
    });
  }

  function handleToggleActive(user: StaffUser) {
    updateMutation.mutate({ id: user.id, data: { active: !user.active } });
  }

  async function handleBulkSetActive(active: boolean) {
    setBulkWorking(true);
    try {
      await Promise.all([...selected].map(id =>
        new Promise<void>((resolve, reject) =>
          updateMutation.mutate({ id, data: { active } }, { onSuccess: () => resolve(), onError: reject })
        )
      ));
      clear();
      void qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
    } finally { setBulkWorking(false); }
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="w-6 h-6 text-blue-600" />
            Staff Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Manage staff accounts and assign access roles</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setTestSendStatus(null); setPreviewOpen(true); }} className="gap-2">
            <Eye className="w-4 h-4" />
            Preview Welcome Email
          </Button>
          <Button onClick={handleInviteOpen} className="gap-2">
            <Plus className="w-4 h-4" />
            Invite Staff
          </Button>
        </div>
      </div>

      <RolePermissionsMatrix />

      <Card>
        <CardContent className="pt-4 pb-0">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>

          <BulkActionBar
            count={selected.size}
            onClear={clear}
            actions={[
              {
                label: bulkWorking ? "Working…" : "Deactivate",
                icon: <UserX className="w-3.5 h-3.5" />,
                className: "text-red-600 border-red-200 hover:bg-red-50",
                onClick: () => void handleBulkSetActive(false),
              },
              {
                label: bulkWorking ? "Working…" : "Reactivate",
                icon: <UserCheck className="w-3.5 h-3.5" />,
                className: "text-green-600 border-green-200 hover:bg-green-50",
                onClick: () => void handleBulkSetActive(true),
              },
            ]}
          />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={isAllSelected ? true : isIndeterminate ? "indeterminate" : false}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))}
              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-gray-400">No staff accounts found.</TableCell>
                </TableRow>
              )}
              {!isLoading && users.map((user) => (
                <TableRow key={user.id} className={selected.has(user.id) ? "bg-blue-50/40" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(user.id)}
                      onCheckedChange={() => toggle(user.id)}
                      aria-label={`Select ${user.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-gray-500">{user.email}</TableCell>
                  <TableCell><RoleBadge role={user.role} /></TableCell>
                  <TableCell>
                    <Badge
                      variant={user.active ? "default" : "secondary"}
                      className={user.active
                        ? "bg-green-100 text-green-800 border border-green-200 hover:bg-green-100"
                        : "bg-gray-100 text-gray-500 border border-gray-200"}
                    >
                      {user.active ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-col gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={isInactive(user.lastActiveAt) ? "text-gray-400" : "text-gray-700"}>
                            {formatRelativeTime(user.lastActiveAt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {user.lastActiveAt
                            ? new Date(user.lastActiveAt).toLocaleString()
                            : "No sessions have been recorded."}
                        </TooltipContent>
                      </Tooltip>
                      <InactivityBadge
                        lastActiveAt={user.lastActiveAt}
                        isActive={user.active}
                        onDeactivate={() => handleToggleActive(user)}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-gray-500 text-sm">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditOpen(user)}>Change role</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleToggleActive(user)}
                          className={user.active ? "text-red-600 focus:text-red-600" : ""}
                        >
                          {user.active ? "Deactivate account" : "Reactivate account"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { setInviteOpen(o); if (!o) resetInviteForm(); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader><DialogTitle>Invite Staff Member</DialogTitle></DialogHeader>
          <form id="invite-staff-form" onSubmit={handleInviteSubmit} className="space-y-4 pt-2 overflow-y-auto flex-1 pr-1 -mr-1">
            <div className="space-y-1">
              <Label htmlFor="inv-name">Full Name</Label>
              <Input id="inv-name" placeholder="Jane Doe" value={newName} onChange={e => setNewName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-email">Email Address</Label>
              <Input id="inv-email" type="email" placeholder="jane@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-password">Temporary Password</Label>
              <Input id="inv-password" type="password" placeholder="Min 8 characters" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-account-phone">Phone Number</Label>
              <Input id="inv-account-phone" type="tel" placeholder="e.g. 0712345678" value={newAccountPhone} onChange={e => setNewAccountPhone(e.target.value)} />
              <p className="text-xs text-gray-400">Used for SMS password reset codes. Optional.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-role">Role</Label>
              <Select value={newRole} onValueChange={v => setNewRole(v as Role)}>
                <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <RoleInlineSummary role={newRole} />
            </div>

            {/* Notification method */}
            <div className="space-y-2 border border-gray-100 rounded-lg p-3 bg-gray-50">
              <Label className="text-sm font-medium text-gray-700">Send Welcome Notification</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: "none",  label: "None",        icon: BellOff },
                  { value: "sms",   label: "SMS",         icon: MessageSquare },
                  { value: "email", label: "Email",       icon: Mail },
                  { value: "both",  label: "SMS + Email", icon: MessageSquare },
                ] as const).map(({ value, label, icon: Icon }) => (
                  <button key={value} type="button" onClick={() => setNotifyMethod(value)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                      notifyMethod === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                    }`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
              {(notifyMethod === "sms" || notifyMethod === "both") && (
                <div className="space-y-1 mt-2">
                  <Label htmlFor="inv-phone" className="text-xs text-gray-600">Phone Number (for SMS)</Label>
                  <input id="inv-phone" type="tel" placeholder="e.g. 0712345678" value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {(notifyMethod === "email" || notifyMethod === "both") && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  Welcome email will be sent to <strong>{newEmail || "the staff email"}</strong>. Requires SMTP configured in Settings.
                </p>
              )}
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>
            )}
          </form>
          <DialogFooter className="pt-2 border-t border-gray-100 mt-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button type="submit" form="invite-staff-form" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit role dialog */}
      <Dialog open={!!editUser} onOpenChange={o => { if (!o) setEditUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Change Role</DialogTitle></DialogHeader>
          {editUser && (
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                Updating role for <strong>{editUser.name}</strong> ({editUser.email})
              </p>
              <div className="space-y-1">
                <Label htmlFor="edit-role">Role</Label>
                <Select value={editRole} onValueChange={v => setEditRole(v as Role)}>
                  <SelectTrigger id="edit-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <RoleInlineSummary role={editRole} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="edit-phone">Phone Number</Label>
                <Input id="edit-phone" type="tel" placeholder="e.g. 0712345678" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
                <p className="text-xs text-gray-400">Used for SMS password reset codes.</p>
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Welcome email preview dialog */}
      <Dialog open={previewOpen} onOpenChange={(o) => { setPreviewOpen(o); if (!o) setTestSendStatus(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-blue-600" />
              Welcome Email Preview
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-4 pt-1">
            {previewQuery.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}

            {previewQuery.isError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                Failed to load email preview. Please try again.
              </p>
            )}

            {previewQuery.data && (
              <>
                {!previewQuery.data.smtpConfigured && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                    <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      SMTP is not configured — welcome emails will be skipped when inviting staff.
                      Configure SMTP in <strong>Settings</strong> to enable email delivery.
                    </span>
                  </div>
                )}

                <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded px-3 py-1.5">
                  This is a preview using sample data (Jane Doe / jane@example.com). Real emails use the actual staff member's details.
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div className="bg-gray-50 border-b border-gray-200 px-3 py-2 text-xs text-gray-500 flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5" />
                    <span><strong>Subject:</strong> Welcome to [Company] — Your Staff Account</span>
                  </div>
                  <iframe
                    srcDoc={previewQuery.data.html}
                    title="Welcome email preview"
                    className="w-full border-0"
                    style={{ height: "420px" }}
                    sandbox="allow-same-origin"
                  />
                </div>
              </>
            )}

            {testSendStatus && (
              <div className={`flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm ${
                testSendStatus.type === "success"
                  ? "border-green-200 bg-green-50 text-green-800"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}>
                {testSendStatus.type === "success"
                  ? <Check className="w-4 h-4 mt-0.5 shrink-0" />
                  : <X className="w-4 h-4 mt-0.5 shrink-0" />}
                <span>{testSendStatus.message}</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-4 border-t border-gray-100 mt-2">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>Close</Button>
            <Button
              type="button"
              onClick={() => { setTestSendStatus(null); sendTestMutation.mutate(); }}
              disabled={sendTestMutation.isPending || !previewQuery.data?.smtpConfigured}
              className="gap-2"
              title={!previewQuery.data?.smtpConfigured ? "Configure SMTP in Settings first" : undefined}
            >
              <Send className="w-4 h-4" />
              {sendTestMutation.isPending ? "Sending…" : "Send Test to My Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  );
}
