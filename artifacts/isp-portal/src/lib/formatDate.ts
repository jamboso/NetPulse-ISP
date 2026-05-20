import { format, isValid } from "date-fns";

export function formatDate(value: string | Date | null | undefined, fmt = "MMM d, yyyy"): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return isValid(d) ? format(d, fmt) : "—";
}
