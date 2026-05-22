import { useState, useCallback } from "react";

export function useBulkSelect<T extends string | number>(items: T[]) {
  const [selected, setSelected] = useState<Set<T>>(new Set());

  const toggle = useCallback((id: T) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(prev =>
      prev.size === items.length && items.length > 0 ? new Set() : new Set(items)
    );
  }, [items]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const isAllSelected = items.length > 0 && selected.size === items.length;
  const isIndeterminate = selected.size > 0 && selected.size < items.length;

  return { selected, toggle, toggleAll, clear, isAllSelected, isIndeterminate };
}
