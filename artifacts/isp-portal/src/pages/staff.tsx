import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import type { StaffUser } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UserCog, Plus, MoreHorizontal, Search } from "lucide-react";

const ROLES = ["admin", "billing", "support", "technician"] as const;
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
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        roleBadgeColor[r] ?? "bg-gray-100 text-gray-800 border-gray-200"
      }`}
    >
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

  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("support");

  const { data, isLoading } = useListUsers({ search: search || undefined });
  const users = data?.data ?? [];

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
    } catch {
      /* ignore */
    }
    return "An unexpected error occurred";
  }

  function resetInviteForm() {
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setNewRole("support");
    setFormError("");
  }

  function handleInviteOpen() {
    resetInviteForm();
    setInviteOpen(true);
  }

  function handleInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    createMutation.mutate({
      data: { name: newName, email: newEmail, password: newPassword, role: newRole },
    });
  }

  function handleEditOpen(user: StaffUser) {
    setFormError("");
    setEditRole(user.role as Role);
    setEditUser(user);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editUser) return;
    setFormError("");
    updateMutation.mutate({ id: editUser.id, data: { role: editRole } });
  }

  function handleToggleActive(user: StaffUser) {
    updateMutation.mutate({ id: user.id, data: { active: !user.active } });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="w-6 h-6 text-blue-600" />
            Staff Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage staff accounts and assign access roles
          </p>
        </div>
        <Button onClick={handleInviteOpen} className="gap-2">
          <Plus className="w-4 h-4" />
          Invite Staff
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 pb-0">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!isLoading && users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-gray-400">
                    No staff accounts found.
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.name}</TableCell>
                    <TableCell className="text-gray-500">{user.email}</TableCell>
                    <TableCell>
                      <RoleBadge role={user.role} />
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.active ? "default" : "secondary"}
                        className={
                          user.active
                            ? "bg-green-100 text-green-800 border border-green-200 hover:bg-green-100"
                            : "bg-gray-100 text-gray-500 border border-gray-200"
                        }
                      >
                        {user.active ? "Active" : "Deactivated"}
                      </Badge>
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
                          <DropdownMenuItem onClick={() => handleEditOpen(user)}>
                            Change role
                          </DropdownMenuItem>
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
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite Staff Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit} className="space-y-4 pt-2">
            <div className="space-y-1">
              <Label htmlFor="inv-name">Full Name</Label>
              <Input
                id="inv-name"
                placeholder="Jane Doe"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-email">Email Address</Label>
              <Input
                id="inv-email"
                type="email"
                placeholder="jane@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-password">Temporary Password</Label>
              <Input
                id="inv-password"
                type="password"
                placeholder="Min 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-role">Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                <SelectTrigger id="inv-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                Admin: full access · Billing: invoices/payments · Support: customers/tickets · Technician: network/equipment
              </p>
            </div>
            {formError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setInviteOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creating…" : "Create Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit role dialog */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
          </DialogHeader>
          {editUser && (
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
              <p className="text-sm text-gray-600">
                Updating role for <strong>{editUser.name}</strong> ({editUser.email})
              </p>
              <div className="space-y-1">
                <Label htmlFor="edit-role">Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as Role)}>
                  <SelectTrigger id="edit-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {roleLabel[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 mt-1">
                  Admin: full access · Billing: invoices/payments · Support: customers/tickets · Technician: network/equipment
                </p>
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditUser(null)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
