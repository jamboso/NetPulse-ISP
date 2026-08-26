import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export type CompanyOption = {
  id: number;
  name: string;
  username: string;
};

async function fetchOwnerCompanies(): Promise<CompanyOption[]> {
  const response = await fetch("/api/companies", { credentials: "include" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Could not load companies (${response.status}).`);
  }
  return Array.isArray(payload?.data) ? payload.data : [];
}

export interface OwnerCompanyScope {
  /** True only for the "owner" role — every other role is already scoped server-side. */
  isOwner: boolean;
  /** The company id the owner picked, or "" if none yet. Non-owners get "". */
  selectedCompanyId: string;
  setSelectedCompanyId: (id: string) => void;
  companies: CompanyOption[] | undefined;
  companiesLoading: boolean;
  companiesError: Error | null;
  /**
   * False only while an owner hasn't picked a company yet. Gate every
   * tenant-scoped query/mutation on this — never load "all companies" data
   * as a fallback.
   */
  scopeReady: boolean;
  /**
   * Pass this as the `request` option to generated API hooks (or spread its
   * headers into a raw `fetch`) so the request carries the owner's chosen
   * company. Undefined for non-owners, who are scoped by their own account.
   */
  companyScopeRequest: { headers: { "x-netpulse-company-id": string } } | undefined;
}

/**
 * Shared owner "pick a company first" scoping mechanism. Generalizes the
 * pattern originally built for Fiber Access so every owner-reachable tenant
 * screen (Network, Network Map, Monitoring, Infrastructure, Fiber Access)
 * behaves the same way: no company selected = explicit empty/prompt state,
 * never a fallback to cross-company data.
 */
export function useOwnerCompanyScope(queryKeyPrefix: string): OwnerCompanyScope {
  const { isOwner } = useCurrentUser();
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  const { data: companies, isLoading: companiesLoading, error: companiesError } = useQuery({
    queryKey: [queryKeyPrefix, "owner-companies"],
    queryFn: fetchOwnerCompanies,
    enabled: isOwner,
  });

  useEffect(() => {
    if (isOwner && companies?.length === 1 && !selectedCompanyId) {
      setSelectedCompanyId(String(companies[0]!.id));
    }
  }, [isOwner, companies, selectedCompanyId]);

  const scopeReady = !isOwner || selectedCompanyId.length > 0;
  const companyScopeRequest = isOwner && selectedCompanyId
    ? { headers: { "x-netpulse-company-id": selectedCompanyId } }
    : undefined;

  return {
    isOwner,
    selectedCompanyId,
    setSelectedCompanyId,
    companies,
    companiesLoading,
    companiesError: companiesError as Error | null,
    scopeReady,
    companyScopeRequest,
  };
}
