---
name: Orval generated hook query options typing
description: Why passing `{ query: { enabled } }` alone to a generated useX hook fails typecheck, and the fix.
---

In this repo's Orval-generated React Query hooks (`lib/api-client-react/src/generated/api.ts`), the `options.query` parameter is typed as `UseQueryOptions<...>` directly (not `Partial<...>`), so TypeScript requires `queryKey` to be present even though the generated `getXQueryOptions` internally falls back to its own default queryKey when one isn't given (`queryOptions?.queryKey ?? getXQueryKey(params)`).

**Why:** Discovered while adding a debounced customer-search box that needed to conditionally disable a `useListCustomers` call via `enabled: false`. Passing only `{ enabled: ... }` throws `TS2741: Property 'queryKey' is missing`.

**How to apply:** When passing `options.query` to any generated `useX` hook in this repo, always include an explicit `queryKey` array alongside other fields like `enabled`, e.g. `{ query: { queryKey: ["some-key", param], enabled: cond } }`. The literal queryKey value doesn't need to match the hook's internal default — react-query just needs a key, and the generated code will use whichever one you provide.
