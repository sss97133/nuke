import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthContext } from '../../../contexts/AuthContext';
import { supabase } from '../../../lib/supabase';
import { decimalUnits } from '../../../services/financialExpenseUse';

export const FINANCIAL_PHASES = ['customer_receipt', 'book_expense', 'customer_refund'] as const;
export type FinancialPhase = typeof FINANCIAL_PHASES[number];
export type FinancialWitness = { kind: 'document' | 'receipt' | 'work' | 'image'; id: string | null; label: string };
export type VehicleFinancialUse = {
  id: string; index: number; owner: string; documentId: string; sourceKey: string; phase: FinancialPhase;
  amount: string | null; bookAmount: string | null; currency: string; date: string | null;
  description: string; category: string | null; account: string | null; basis: string | null; qualification: string;
  bankDocumentId: string | null; bankSourceKey: string | null; bankAmount: string | null; bankDate: string | null; bankRemainder: string | null;
  invoiceDocumentId: string | null; invoiceReference: string | null; jobId: string | null; receiptId: string | null; itemId: string | null;
  witnesses: FinancialWitness[];
};
const text = (v: unknown) => typeof v === 'string' ? v : null;
export const decimal = (v: unknown) => typeof v === 'string' && /^-?\d{1,12}(\.\d{1,6})?$/.test(v) ? v : null;
export function parseFinancialUse(r: Record<string, unknown>): VehicleFinancialUse | null {
  if (!FINANCIAL_PHASES.includes(r.phase as FinancialPhase) || !text(r.use_id) || !text(r.book_owner_id) || !text(r.document_id)) return null;
  return { id: String(r.use_id), index: Number(r.allocation_index), owner: String(r.book_owner_id), documentId: String(r.document_id), sourceKey: String(r.record_source_key),
    phase: r.phase as FinancialPhase, amount: decimal(r.allocated_amount), bookAmount: decimal(r.book_amount), currency: text(r.currency) ?? '',
    date: text(r.record_date), description: text(r.description) ?? 'Recorded allocation', category: text(r.category), account: text(r.account), basis: text(r.basis),
    qualification: text(r.qualification) ?? 'unresolved', bankDocumentId: text(r.bank_document_id), bankSourceKey: text(r.bank_source_key),
    bankAmount: decimal(r.bank_amount), bankDate: text(r.bank_date), bankRemainder: decimal(r.bank_remainder), invoiceDocumentId: text(r.invoice_document_id),
    invoiceReference: text(r.invoice_reference), jobId: text(r.work_order_id), receiptId: text(r.receipt_id), itemId: text(r.receipt_item_id),
    witnesses: Array.isArray(r.witnesses) ? r.witnesses.flatMap((w: Record<string, unknown>) =>
      ['document', 'receipt', 'work', 'image'].includes(String(w.kind)) ? [{ kind: w.kind as FinancialWitness['kind'], id: text(w.id), label: text(w.label) ?? 'Cited source' }] : []) : [],
  };
}
const MICRO = 1_000_000n;
export const moneyMicros = decimalUnits;
/** Sum exact allocation decimals first; round once at the currency's display boundary. */
export function totalMoney(rows: VehicleFinancialUse[]): string | null {
  const seen = new Set<string>(); let amount = 0n, known = false;
  if (rows.some(row => row.owner !== rows[0].owner || row.currency !== rows[0].currency || row.phase !== rows[0].phase)) return null;
  for (const row of rows) {
    const key = `${row.owner}:${row.id}:${row.index}`;
    if (seen.has(key)) continue; seen.add(key);
    if (row.qualification !== 'ready' || row.amount == null) continue;
    amount += moneyMicros(row.amount); known = true;
  }
  if (!known) return null;
  return `${amount < 0 ? '-' : ''}${(amount < 0 ? -amount : amount) / MICRO}.${((amount < 0 ? -amount : amount) % MICRO).toString().padStart(6, '0')}`;
}
export function moneyLabel(value: string | null, currency: string): string {
  if (value == null || !/^-?\d+(\.\d{1,6})?$/.test(value) || !/^[A-Z]{3}$/.test(currency)) return 'Amount unavailable';
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: currency === 'USD' ? 'symbol' : 'code' });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  if (!decimal(value)) return `${value} ${currency}`;
  const exact = moneyMicros(value), absolute = exact < 0 ? -exact : exact, divisor = 10n ** BigInt(6 - digits);
  const minor = (absolute + divisor / 2n) / divisor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return `${value} ${currency}`;
  return formatter.format(Number(exact < 0 ? -minor : minor) / 10 ** digits);
}
export const financialDate = (row: VehicleFinancialUse) => row.phase === 'book_expense' ? row.date : row.bankDate;

export function useVehicleFinancials(vehicleId: string) {
  const { user, loading } = useAuthContext();
  const read = useInfiniteQuery({
    queryKey: ['vehicle-financial-uses', vehicleId, user?.id ?? 'anon'], initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await supabase.rpc('accounting_vehicle_financials', { p_vehicle_id: vehicleId })
        .range(pageParam, pageParam + 199).abortSignal(signal);
      if (error || !Array.isArray(data)) throw new Error('Vehicle financial allocations could not load.');
      const rows = data.map(parseFinancialUse);
      if (rows.some(row => row == null)) throw new Error('Vehicle financial allocations could not be read.');
      return rows as VehicleFinancialUse[];
    },
    getNextPageParam: (last, pages) => last.length === 200 ? pages.reduce((n, page) => n + page.length, 0) : undefined,
    enabled: !!vehicleId && !!user && !loading, staleTime: 60_000, gcTime: 0, retry: false,
  });
  const rows = [...new Map((read.data?.pages.flat() ?? []).map(row => [`${row.owner}:${row.id}:${row.index}`, row])).values()];
  return { ...read, rows, complete: !!read.data && !read.hasNextPage };
}
