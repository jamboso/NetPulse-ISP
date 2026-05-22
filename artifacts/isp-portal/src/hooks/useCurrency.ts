import { useGetSettings } from "@workspace/api-client-react";

const SYMBOLS: Record<string, string> = {
  KES: "KSh",
  USD: "$",
  EUR: "€",
  GBP: "£",
};

const LOCALES: Record<string, string> = {
  KES: "en-KE",
  USD: "en-US",
  EUR: "en-EU",
  GBP: "en-GB",
};

export function useCurrency() {
  const { data } = useGetSettings();
  const currency = (data as Record<string, string> | undefined)?.currency ?? "KES";
  const symbol = SYMBOLS[currency] ?? currency;
  const locale = LOCALES[currency] ?? "en-US";

  const fmtMoney = (amount: number, decimals = 2): string => {
    const formatted = amount.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return symbol === "$" || symbol === "€" || symbol === "£"
      ? `${symbol}${formatted}`
      : `${symbol} ${formatted}`;
  };

  const fmtMoneyCompact = (amount: number): string => {
    if (amount >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000)     return `${symbol}${(amount / 1_000).toFixed(0)}K`;
    return fmtMoney(amount, 0);
  };

  return { currency, symbol, fmtMoney, fmtMoneyCompact };
}
