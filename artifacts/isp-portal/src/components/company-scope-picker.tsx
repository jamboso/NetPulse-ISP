import { Building2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OwnerCompanyScope } from "@/hooks/useOwnerCompanyScope";

/**
 * Renders the "choose a company first" banner for owner-only screens.
 * Pass the object returned by `useOwnerCompanyScope`. Renders nothing for
 * non-owners (they're already scoped to their own company server-side).
 */
export function CompanyScopePicker({
  scope, id, title, description,
}: {
  scope: OwnerCompanyScope;
  id: string;
  title?: string;
  description?: string;
}) {
  if (!scope.isOwner) return null;

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-semibold text-indigo-950">{title ?? "Choose a customer company"}</h2>
          <p className="mt-1 max-w-2xl text-sm text-indigo-800">
            {description ?? "This data belongs to one company at a time. Choose the company before viewing or changing its records."}
          </p>
        </div>
        <div className="w-full sm:w-72">
          <Label htmlFor={id} className="text-xs text-indigo-900">Company</Label>
          <Select
            value={scope.selectedCompanyId || undefined}
            onValueChange={scope.setSelectedCompanyId}
            disabled={scope.companiesLoading}
          >
            <SelectTrigger id={id} className="mt-1 bg-white">
              <SelectValue placeholder={scope.companiesLoading ? "Loading companies…" : "Select a company"} />
            </SelectTrigger>
            <SelectContent>
              {scope.companies?.map((company) => (
                <SelectItem key={company.id} value={String(company.id)}>{company.name} ({company.username})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {scope.companiesError && <p className="mt-3 text-sm text-red-700">{scope.companiesError.message}</p>}
      {!scope.companiesLoading && !scope.companiesError && !scope.companies?.length && (
        <p className="mt-3 text-sm text-amber-800">No customer companies are available yet. Create one first, then return here.</p>
      )}
    </section>
  );
}

/** Dashed-border placeholder shown instead of the page body until a company is chosen. */
export function CompanyScopeEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <section className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
      <Building2 className="mx-auto h-8 w-8 text-gray-400" />
      <h2 className="mt-3 font-semibold text-gray-900">{title}</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm text-gray-600">{description}</p>
    </section>
  );
}
