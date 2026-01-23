const CURRENCY_ALIAS_MAP: Record<string, string> = {
  '$': 'USD',
  'US$': 'USD',
  'USD': 'USD',
  '€': 'EUR',
  'EUR': 'EUR',
  '£': 'GBP',
  'GBP': 'GBP',
  'AED': 'AED',
  'د.إ': 'AED',
  'CHF': 'CHF',
  'JPY': 'JPY',
  'CAD': 'CAD',
  'AUD': 'AUD',
};

export const normalizeCurrencyCode = (raw?: string | null): string | null => {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const direct = CURRENCY_ALIAS_MAP[trimmed] || CURRENCY_ALIAS_MAP[trimmed.toUpperCase()];
  if (direct) return direct;
  const upper = trimmed.toUpperCase();
  const codeMatch = upper.match(/\b([A-Z]{3})\b/);
  if (codeMatch?.[1]) return codeMatch[1];
  return null;
};

export const resolveCurrencyCode = (...candidates: Array<string | null | undefined>): string | null => {
  for (const candidate of candidates) {
    const normalized = normalizeCurrencyCode(candidate ?? null);
    if (normalized) return normalized;
  }
  return null;
};

export const formatCurrencyAmount = (
  amount: number | null | undefined,
  options?: {
    currency?: string | null;
    maximumFractionDigits?: number;
    minimumFractionDigits?: number;
    locale?: string;
    fallback?: string;
  },
): string => {
  const fallback = options?.fallback ?? '—';
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return fallback;
  const currency = normalizeCurrencyCode(options?.currency ?? null) || 'USD';
  const locale = options?.locale || 'en-US';
  const maximumFractionDigits = options?.maximumFractionDigits ?? 0;
  const minimumFractionDigits = options?.minimumFractionDigits ?? 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits,
      minimumFractionDigits,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits,
      minimumFractionDigits,
    }).format(amount);
  }
};

export const formatCurrencyFromCents = (
  cents: number | null | undefined,
  options?: {
    currency?: string | null;
    maximumFractionDigits?: number;
    minimumFractionDigits?: number;
    locale?: string;
    fallback?: string;
  },
): string => {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return options?.fallback ?? '—';
  return formatCurrencyAmount(cents / 100, options);
};
