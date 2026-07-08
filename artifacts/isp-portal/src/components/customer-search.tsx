import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Search, X, Loader2, User } from "lucide-react";
import { useListCustomers } from "@workspace/api-client-react";

const STATUS_DOT: Record<string, string> = {
  active: "bg-green-500",
  suspended: "bg-orange-500",
  terminated: "bg-red-500",
};

export function CustomerSearch() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useListCustomers(
    { search: debounced, limit: 8 },
    { query: { queryKey: ["customer-search", debounced], enabled: debounced.length > 0 } },
  );

  const results = debounced.length > 0 ? (data?.data ?? []) : [];

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    setHighlighted(0);
  }, [results.length, debounced]);

  function selectCustomer(id: number) {
    setOpen(false);
    setQuery("");
    setDebounced("");
    navigate(`/customers/${id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[highlighted];
      if (target) selectCustomer(target.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.trim().length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search customers by name or username…"
          className="w-full h-9 pl-9 pr-8 rounded-md border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setDebounced("");
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && debounced.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg overflow-hidden">
          {isFetching ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-500">
              No customers found for "{debounced}"
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((customer, i) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => selectCustomer(customer.id)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm ${
                      i === highlighted ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">{customer.name}</span>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[customer.status] ?? "bg-gray-400"}`} />
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {customer.pppoeUsername ? `@${customer.pppoeUsername}` : customer.email}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
