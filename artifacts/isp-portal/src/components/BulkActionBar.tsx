import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BulkAction = {
  label: string;
  icon?: React.ReactNode;
  variant?: "default" | "destructive" | "outline" | "ghost";
  className?: string;
  onClick: () => void;
};

interface BulkActionBarProps {
  count: number;
  actions: BulkAction[];
  onClear: () => void;
}

export function BulkActionBar({ count, actions, onClear }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border-b border-blue-200 animate-in slide-in-from-top-1 duration-150">
      <span className="text-sm font-semibold text-blue-800 shrink-0">
        {count} selected
      </span>
      <div className="h-4 w-px bg-blue-200" />
      <div className="flex items-center gap-2 flex-wrap">
        {actions.map((action, i) => (
          <Button
            key={i}
            size="sm"
            variant={action.variant ?? "outline"}
            className={`h-7 text-xs gap-1.5 ${action.className ?? ""}`}
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
      </div>
      <button
        onClick={onClear}
        className="ml-auto text-blue-500 hover:text-blue-700 shrink-0"
        title="Clear selection"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
