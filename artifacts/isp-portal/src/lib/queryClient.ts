import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";

function isCompanySuspendedError(error: unknown): boolean {
  const err = error as { status?: number; data?: { code?: string } } | undefined;
  return err?.status === 402 && err?.data?.code === "COMPANY_SUSPENDED";
}

function handleSuspension(error: unknown): void {
  if (isCompanySuspendedError(error) && window.location.pathname !== "/suspended") {
    window.location.href = "/suspended";
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleSuspension,
  }),
  mutationCache: new MutationCache({
    onError: handleSuspension,
  }),
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
});
