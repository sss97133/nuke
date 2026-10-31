import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuthContext } from '../../../contexts/AuthContext';

// Shape mirrors vehicle_observations rows with kind='work_record' AND
// extraction_method='audit_draft_v0'. Read owner-scoped via the
// get_vehicle_build_ledger SECURITY DEFINER RPC (see migration
// 20260708130000_get_vehicle_build_ledger.sql) — NOT a direct table read,
// because the public-vehicle RLS branch would leak this financial data.

export type BuildEventType = 'parts_purchase' | 'labor_payment' | 'capital_investment';
export type BuildDirection = 'out' | 'liability';

export interface BuildLedgerEntry {
  id: string;
  observedAt: string | null;
  description: string;
  amountUsd: number | null;
  direction: BuildDirection | string;
  eventType: BuildEventType | string;
  counterparty: string | null;
  entityPaid: string | null;
  evidenceTier: string | null;
  attributionTier: string | null;
  attributionBasis: string | null;
  channel: string | null;
  citation: Record<string, unknown>;
  needsOwnerConfirmation: boolean;
  confirmationQuestion: string | null;
  orderTotalUsd: number | null;
  splitMethod: string | null;
  auditRun: string | null;
}

export interface BuildLedgerGroup {
  eventType: BuildEventType | string;
  label: string;
  entries: BuildLedgerEntry[];
  documentedTotal: number | null;
  statedPendingTotal: number | null;
}

// A cost the accounting book assigns to this vehicle (expense-use cell on a booked Expense), read through the
// accounting_vehicle_costs RPC: only for a caller who can read that book AND has vehicle access. A separate type from
// BuildLedgerEntry on purpose: it never enters the audit groups, totals or confirmation count (no blending, no
// double counting with audit rows that cite the same payment).
export interface BookCostEntry {
  id: string; // the book cell id, never a vehicle_observations id
  bookOwnerId: string;
  documentId: string;
  ledgerId: string | null;
  year: string | null;
  date: string | null;
  description: string;
  account: string | null;
  category: string | null;
  kind: BuildEventType | null;
  allocated: number | null; // null: the amount is still to be split between this vehicle and other items
  bookAmount: number | null;
  currency: string;
  basis: string | null;
  assignedBy: string | null;
  assignedMethod: string | null;
  assignedAt: string | null;
}

export interface BookCostTotal {
  currency: string;
  total: number | null;
  entries: number;
  unsplit: number;
}

// The owner's spreadsheets from the time that name this vehicle, read through owner_working_notes: context beside the
// books, never summed. A separate type again: no amount here enters any group, total or confirmation count.
export interface WorkingNoteRow {
  r: number;
  d: string | null;
  t: string;
  a: string | null;
}

export interface WorkingNoteTable {
  cellId: string;
  documentId: string;
  bookOwnerId: string;
  workbook: string | null;
  sheet: string | null;
  table: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodBasis: string | null;
  vehicleMatch: 'table' | 'rows' | 'candidate' | null;
  rowsTotal: number;
  rowsMatched: number;
  rows: WorkingNoteRow[];
}

export function parseWorkingNotes(payload: unknown, bookOwnerId: string): WorkingNoteTable[] {
  const tables = (payload as { tables?: unknown })?.tables;
  if (!Array.isArray(tables)) return [];
  return tables.map((t: Record<string, any>): WorkingNoteTable => ({
    cellId: String(t.cell_id),
    documentId: String(t.document_id),
    bookOwnerId,
    workbook: str(t.workbook),
    sheet: str(t.sheet),
    table: str(t.table),
    periodFrom: str(t.period?.from),
    periodTo: str(t.period?.to),
    periodBasis: str(t.period?.basis),
    vehicleMatch: ['table', 'rows', 'candidate'].includes(t.vehicle_match) ? t.vehicle_match : null,
    rowsTotal: num(t.rows_total),
    rowsMatched: num(t.rows_matched),
    rows: Array.isArray(t.rows)
      ? t.rows.map((r: Record<string, unknown>) => ({ r: num(r.r), d: str(r.d), t: str(r.t) ?? '', a: str(r.a) }))
      : [],
  }));
}

export interface BuildLedgerData {
  groups: BuildLedgerGroup[];
  documentedTotal: number | null;
  statedPendingTotal: number | null;
  pendingCount: number;
  entryCount: number;
  auditRun: string | null;
  hasAudit: boolean;
  book: BookCostEntry[];
  bookTotals: BookCostTotal[];
  notes: WorkingNoteTable[];
  hasData: boolean;
}

// Book category → ledger group label for a booked cost; null when the category names neither (or both).
export function bookCostKind(category: string | null): BuildEventType | null {
  const c = (category ?? '').toLowerCase();
  const parts = /parts|materials/.test(c), labor = /labou?r|subcontract|machining/.test(c);
  return parts === labor ? null : parts ? 'parts_purchase' : 'labor_payment';
}

const GROUP_ORDER: { type: BuildEventType; label: string }[] = [
  { type: 'parts_purchase', label: 'Parts' },
  { type: 'labor_payment', label: 'Labor' },
  { type: 'capital_investment', label: 'Capital' },
];

// Documented = money out, attributed with certain/probable/likely evidence.
// Kept strictly separate from stated/pending — never blended into one number.
const DOCUMENTED_TIERS = new Set(['certain', 'probable', 'likely']);

function isDocumented(e: BuildLedgerEntry): boolean {
  return e.direction === 'out' && DOCUMENTED_TIERS.has(String(e.attributionTier));
}

// Stated/pending = owner-stated tier, or a liability (e.g. investor capital owed).
function isStatedPending(e: BuildLedgerEntry): boolean {
  return e.attributionTier === 'stated' || e.direction === 'liability';
}

function auditSubtotal(rows: BuildLedgerEntry[], eligible: (entry: BuildLedgerEntry) => boolean): number | null {
  const known = rows.filter(entry => eligible(entry) && entry.amountUsd != null);
  return known.length ? known.reduce((sum, entry) => sum + Math.round(entry.amountUsd! * 100), 0) / 100 : null;
}

function num(v: unknown): number {
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : 0;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function nullableMoney(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value))) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export interface VehicleReceiptRecord {
  id: string; vendor: string | null; currency: string | null;
  amount: number | null; total: number | null; totalAmount: number | null; amountConflict: boolean;
  date: string | null; dates: string[]; dateConflict: boolean;
  status: string | null; processingStatus: string | null;
  sourceTable: string | null; sourceId: string | null;
}

export function parseVehicleReceiptRecord(row: Record<string, unknown>): VehicleReceiptRecord {
  const total = nullableMoney(row.total), totalAmount = nullableMoney(row.total_amount);
  const amountConflict = total != null && totalAmount != null && total !== totalAmount;
  const dates = [...new Set([row.purchase_date, row.transaction_date, row.receipt_date]
    .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)))];
  return { id: String(row.id), vendor: str(row.vendor_name), currency: typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null,
    amount: amountConflict ? null : total ?? totalAmount, total, totalAmount, amountConflict,
    date: dates.length === 1 ? dates[0] : null, dates, dateConflict: dates.length > 1,
    status: str(row.status), processingStatus: str(row.processing_status), sourceTable: str(row.source_document_table), sourceId: str(row.source_document_id) };
}

/** Existing column-limited public receipt projection; originals and private books retain their own access checks. */
export function useVehicleReceiptRecords(vehicleId: string) {
  const { user, loading } = useAuthContext();
  const read = useInfiniteQuery({
    queryKey: ['vehicle-financial-receipts', vehicleId, user?.id ?? 'anon'],
    initialPageParam: { offset: 0, source: user ? 'receipts' : 'receipts_public_summary' },
    queryFn: async ({ pageParam }) => {
      const readPage = (source: string) => supabase.from(source)
        .select('id,vendor_name,total,total_amount,currency,purchase_date,transaction_date,receipt_date,status,processing_status,source_document_table,source_document_id', { count: 'exact' })
        .or(`vehicle_id.eq.${vehicleId},and(scope_type.eq.vehicle,scope_id.eq.${vehicleId})`)
        .order('created_at', { ascending: false }).order('id').range(pageParam.offset, pageParam.offset + 99);
      let source = pageParam.source;
      let result = await readPage(source);
      // RLS may withhold the base rows from a signed-in non-owner. Reuse only the
      // existing public summary, and keep that source for subsequent pages.
      if (source === 'receipts' && pageParam.offset === 0 && (result.error || result.data?.length === 0)) {
        source = 'receipts_public_summary'; result = await readPage(source);
      }
      const { data, error, count } = result;
      if (error || !Array.isArray(data)) throw new Error('Receipt summaries could not load.');
      return { rows: data.map(parseVehicleReceiptRecord), total: count ?? null, source };
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.rows.length, 0);
      return last.rows.length === 0 || (last.total != null && loaded >= last.total) ? undefined : { offset: loaded, source: last.source };
    },
    enabled: !!vehicleId && !loading,
    staleTime: 60_000, gcTime: 0, retry: false,
  });
  const rows = useMemo(() => [...new Map((read.data?.pages.flatMap(page => page.rows) ?? []).map(row => [row.id, row])).values()], [read.data]);
  return { ...read, rows, total: read.data?.pages[0]?.total ?? null };
}

export function useVehicleWorkOrderFinancials(vehicleId: string) {
  const { user, loading } = useAuthContext();
  return useQuery({
    queryKey: ['vehicle-financial-work-orders', vehicleId, user?.id ?? 'anon'],
    queryFn: async () => {
      const [orders, units] = await Promise.all([
        supabase.from('work_order_receipt_unified')
          .select('work_order_id,work_order_title,work_order_status,work_order_created,parts_count,labor_count,payment_count,invoice_total,payments_total,balance_due', { count: 'exact' })
          .eq('vehicle_id', vehicleId).order('work_order_created', { ascending: false }).limit(200),
        supabase.from('work_orders').select('id,currency').eq('vehicle_id', vehicleId).limit(200),
      ]);
      if (orders.error || !Array.isArray(orders.data)) throw new Error('Work-order financial records could not load.');
      const currencies = new Map((units.error ? [] : units.data ?? []).map(row => [row.id, typeof row.currency === 'string' && /^[A-Z]{3}$/.test(row.currency) ? row.currency : null]));
      return { rows: orders.data.map(row => ({ id: String(row.work_order_id), title: str(row.work_order_title), status: str(row.work_order_status),
        currency: currencies.get(row.work_order_id) ?? null, createdAt: str(row.work_order_created),
        pricedEntries: num(row.parts_count) + num(row.labor_count), paymentCount: num(row.payment_count),
        charges: nullableMoney(row.invoice_total), paid: nullableMoney(row.payments_total), remainder: nullableMoney(row.balance_due) })), total: orders.count ?? null };
    },
    enabled: !!vehicleId && !loading && !!user,
    staleTime: 60_000, gcTime: 0, retry: false,
  });
}

interface RawLedgerRow {
  observation_id: string;
  observed_at: string | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
}

/** Parse the existing accounting reader without inventing currency or an unsplit amount. */
export function parseVehicleBookCosts(data: Record<string, unknown>[]): BookCostEntry[] {
  return (data as Record<string, unknown>[]).map((r): BookCostEntry => ({
    id: String(r.use_id),
    bookOwnerId: String(r.book_owner_id),
    documentId: String(r.document_id),
    ledgerId: str(r.ledger_id),
    year: str(r.record_year),
    date: str(r.record_date),
    description: str(r.description) ?? '',
    account: str(r.account),
    category: str(r.category),
    kind: bookCostKind(str(r.category)),
    allocated: nullableMoney(r.allocated_amount),
    bookAmount: nullableMoney(r.book_amount),
    currency: typeof r.currency === 'string' && /^[A-Z]{3}$/.test(r.currency) ? r.currency : '',
    basis: str(r.basis),
    assignedBy: str(r.assigned_by),
    assignedMethod: str(r.assigned_method),
    assignedAt: str(r.assigned_at),
  }));
}

/** Shared by the header and build ledger. A caller's books never reuse another caller's cache. */
export function useVehicleBookCosts(vehicleId: string | undefined) {
  const { user, loading } = useAuthContext();
  const read = useQuery({
    queryKey: ['build-ledger', vehicleId, 'book', user?.id ?? 'anon', 'coverage-v1'],
    queryFn: async () => {
      const { data, error, count } = await supabase.rpc('accounting_vehicle_costs', { p_vehicle_id: vehicleId! }, { count: 'exact' });
      if (error || !Array.isArray(data)) throw new Error('Vehicle costs could not load.');
      return { entries: parseVehicleBookCosts(data), total: count ?? null };
    },
    enabled: !!vehicleId && !loading && !!user,
    staleTime: 60 * 1000,
    gcTime: 0,
    retry: false,
  });
  return { ...read, data: read.data?.entries, total: read.data?.total ?? null };
}

export function useBuildLedger(vehicleId: string | undefined) {
  const { user, loading: authLoading } = useAuthContext();
  const auditRead = useQuery({
    queryKey: ['build-ledger', vehicleId, 'audit', user?.id ?? 'anon'],
    queryFn: async (): Promise<BuildLedgerEntry[]> => {
      if (!vehicleId) return [];
      const { data, error: rpcErr } = await supabase.rpc('get_vehicle_build_ledger', {
        p_vehicle_id: vehicleId,
      });
      if (rpcErr || !Array.isArray(data)) throw new Error('Build records could not load.');
      return (data as RawLedgerRow[]).map((r): BuildLedgerEntry => {
        const sd = (r.structured_data ?? {}) as Record<string, unknown>;
        return {
          id: r.observation_id,
          observedAt: r.observed_at ?? null,
          description: r.content_text ?? '',
          amountUsd: nullableMoney(sd.amount_usd),
          direction: str(sd.direction) ?? 'unknown',
          eventType: str(sd.event_type) ?? 'unknown',
          counterparty: str(sd.counterparty),
          entityPaid: str(sd.entity_paid),
          evidenceTier: str(sd.evidence_tier),
          attributionTier: str(sd.attribution_tier),
          attributionBasis: str(sd.attribution_basis),
          channel: str(sd.channel),
          citation: (sd.citation ?? {}) as Record<string, unknown>,
          needsOwnerConfirmation: sd.needs_owner_confirmation === true,
          confirmationQuestion: str(sd.confirmation_question),
          orderTotalUsd: nullableMoney(sd.order_total_usd),
          splitMethod: str(sd.split_method),
          auditRun: str(sd.audit_run),
        };
      });
    },
    enabled: !!vehicleId && vehicleId.length >= 20 && !authLoading && !!user,
    staleTime: 60 * 1000,
    gcTime: 0,
    retry: false,
  });

  const bookRead = useVehicleBookCosts(vehicleId);
  const { data: bookRows, isLoading: bookLoading } = bookRead;

  // Working notes stay in the signed-in viewer's own book; read failures remain distinct from empty.
  const noteRead = useQuery({
    queryKey: ['build-ledger', vehicleId, 'working-notes', user?.id ?? 'anon'],
    queryFn: async (): Promise<WorkingNoteTable[]> => {
      if (!vehicleId) return [];
      const uid = user?.id;
      if (!uid) return [];
      const { data, error: rpcErr } = await supabase.rpc('owner_working_notes', {
        p_owner_id: uid, p_vehicle_id: vehicleId, p_rows: 20, p_limit: 10,
      });
      if (rpcErr || !data) throw new Error('Working notes could not load.');
      return parseWorkingNotes(data, uid);
    },
    enabled: !!vehicleId && vehicleId.length >= 20 && !authLoading && !!user,
    staleTime: 60 * 1000,
    gcTime: 0,
    retry: false,
  });

  const { data: rawRows, isLoading, error } = auditRead;
  const { data: noteTables, isLoading: notesLoading } = noteRead;
  const data = useMemo<BuildLedgerData>(() => {
    const notes = noteTables ?? [];
    const rows = rawRows ?? [];
    const book = [...(bookRows ?? [])].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
    // Per currency, summed in cents; an unsplit assignment is counted, never summed.
    const byCurrency = new Map<string, { cents: number; entries: number; unsplit: number }>();
    for (const e of book) {
      const t = byCurrency.get(e.currency) ?? { cents: 0, entries: 0, unsplit: 0 };
      t.entries += 1;
      if (e.allocated == null) t.unsplit += 1; else t.cents += Math.round(e.allocated * 100);
      byCurrency.set(e.currency, t);
    }
    const bookTotals: BookCostTotal[] = [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, t]) => ({ currency, total: t.entries > t.unsplit ? t.cents / 100 : null, entries: t.entries, unsplit: t.unsplit }));
    if (rows.length === 0) {
      return {
        groups: [], documentedTotal: null, statedPendingTotal: null,
        pendingCount: 0, entryCount: 0, auditRun: null, hasAudit: false,
        book, bookTotals, notes, hasData: book.length > 0 || notes.length > 0,
      };
    }

    const knownTypes = new Set<string>(GROUP_ORDER.map(group => group.type));
    const otherTypes = [...new Set(rows.map(row => row.eventType).filter(type => !knownTypes.has(type)))].sort();
    const groupOrder = [...GROUP_ORDER, ...otherTypes.map(type => ({ type, label: 'Other build records' }))];
    const groups: BuildLedgerGroup[] = groupOrder.map(({ type, label }) => {
      const entries = rows
        .filter(e => e.eventType === type)
        .sort((a, b) => (a.observedAt ?? '').localeCompare(b.observedAt ?? ''));
      return {
        eventType: type,
        label,
        entries,
        documentedTotal: auditSubtotal(entries, isDocumented),
        statedPendingTotal: auditSubtotal(entries, isStatedPending),
      };
    }).filter(g => g.entries.length > 0);

    return {
      groups,
      documentedTotal: auditSubtotal(rows, isDocumented),
      statedPendingTotal: auditSubtotal(rows, isStatedPending),
      pendingCount: rows.filter(e => e.needsOwnerConfirmation).length,
      entryCount: rows.length,
      auditRun: rows.find(e => e.auditRun)?.auditRun ?? null,
      hasAudit: true,
      book,
      bookTotals,
      notes,
      hasData: true,
    };
  }, [rawRows, bookRows, noteTables]);

  return { data, loading: !!user && (isLoading || bookLoading || notesLoading),
    error: error?.message ?? bookRead.error?.message ?? noteRead.error?.message ?? null,
    failures: { audit: !!error, book: bookRead.isError, notes: noteRead.isError },
    bookCoverage: { shown: bookRows?.length ?? 0, total: bookRead.total },
    retry: () => Promise.all([auditRead.refetch(), bookRead.refetch(), noteRead.refetch()]) };
}
