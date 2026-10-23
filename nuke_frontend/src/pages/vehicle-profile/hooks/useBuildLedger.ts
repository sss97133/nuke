import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../../lib/supabase';

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
  amountUsd: number;
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
  eventType: BuildEventType;
  label: string;
  entries: BuildLedgerEntry[];
  documentedTotal: number;
  statedPendingTotal: number;
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
  total: number;
  entries: number;
  unsplit: number;
}

export interface BuildLedgerData {
  groups: BuildLedgerGroup[];
  documentedTotal: number;
  statedPendingTotal: number;
  pendingCount: number;
  entryCount: number;
  auditRun: string | null;
  hasAudit: boolean;
  book: BookCostEntry[];
  bookTotals: BookCostTotal[];
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

function num(v: unknown): number {
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : 0;
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

interface RawLedgerRow {
  observation_id: string;
  observed_at: string | null;
  content_text: string | null;
  structured_data: Record<string, unknown> | null;
}

export function useBuildLedger(vehicleId: string | undefined) {
  const { data: rawRows, isLoading, error } = useQuery({
    queryKey: ['build-ledger', vehicleId],
    queryFn: async (): Promise<BuildLedgerEntry[]> => {
      if (!vehicleId) return [];
      const { data, error: rpcErr } = await supabase.rpc('get_vehicle_build_ledger', {
        p_vehicle_id: vehicleId,
      });
      // Degrade silently: a non-owner (or not-yet-applied migration) yields no
      // rows and the section renders null. Never surface financial errors in UI.
      if (rpcErr || !Array.isArray(data)) return [];
      return (data as RawLedgerRow[]).map((r): BuildLedgerEntry => {
        const sd = (r.structured_data ?? {}) as Record<string, unknown>;
        return {
          id: r.observation_id,
          observedAt: r.observed_at ?? null,
          description: r.content_text ?? '',
          amountUsd: num(sd.amount_usd),
          direction: str(sd.direction) ?? 'out',
          eventType: str(sd.event_type) ?? 'parts_purchase',
          counterparty: str(sd.counterparty),
          entityPaid: str(sd.entity_paid),
          evidenceTier: str(sd.evidence_tier),
          attributionTier: str(sd.attribution_tier),
          attributionBasis: str(sd.attribution_basis),
          channel: str(sd.channel),
          citation: (sd.citation ?? {}) as Record<string, unknown>,
          needsOwnerConfirmation: sd.needs_owner_confirmation === true,
          confirmationQuestion: str(sd.confirmation_question),
          orderTotalUsd: sd.order_total_usd != null ? num(sd.order_total_usd) : null,
          splitMethod: str(sd.split_method),
          auditRun: str(sd.audit_run),
        };
      });
    },
    enabled: !!vehicleId && vehicleId.length >= 20,
    staleTime: 10 * 60 * 1000,
  });

  // Costs assigned to this vehicle in the accounting book. Same silent degrade as above: no book access, no vehicle
  // access or a not-yet-applied migration yields no rows.
  const { data: bookRows, isLoading: bookLoading } = useQuery({
    queryKey: ['build-ledger', vehicleId, 'book'],
    queryFn: async (): Promise<BookCostEntry[]> => {
      if (!vehicleId) return [];
      const { data, error: rpcErr } = await supabase.rpc('accounting_vehicle_costs', { p_vehicle_id: vehicleId });
      if (rpcErr || !Array.isArray(data)) return [];
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
        allocated: r.allocated_amount != null && !Number.isNaN(Number(r.allocated_amount)) ? Number(r.allocated_amount) : null,
        bookAmount: r.book_amount != null && !Number.isNaN(Number(r.book_amount)) ? Number(r.book_amount) : null,
        currency: str(r.currency) ?? 'USD',
        basis: str(r.basis),
        assignedBy: str(r.assigned_by),
        assignedMethod: str(r.assigned_method),
        assignedAt: str(r.assigned_at),
      }));
    },
    enabled: !!vehicleId && vehicleId.length >= 20,
    staleTime: 10 * 60 * 1000,
  });

  const data = useMemo<BuildLedgerData>(() => {
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
      .map(([currency, t]) => ({ currency, total: t.cents / 100, entries: t.entries, unsplit: t.unsplit }));
    if (rows.length === 0) {
      return {
        groups: [], documentedTotal: 0, statedPendingTotal: 0,
        pendingCount: 0, entryCount: 0, auditRun: null, hasAudit: false,
        book, bookTotals, hasData: book.length > 0,
      };
    }

    const groups: BuildLedgerGroup[] = GROUP_ORDER.map(({ type, label }) => {
      const entries = rows
        .filter(e => e.eventType === type)
        .sort((a, b) => (a.observedAt ?? '').localeCompare(b.observedAt ?? ''));
      return {
        eventType: type,
        label,
        entries,
        documentedTotal: entries.filter(isDocumented).reduce((s, e) => s + e.amountUsd, 0),
        statedPendingTotal: entries.filter(isStatedPending).reduce((s, e) => s + e.amountUsd, 0),
      };
    }).filter(g => g.entries.length > 0);

    return {
      groups,
      documentedTotal: rows.filter(isDocumented).reduce((s, e) => s + e.amountUsd, 0),
      statedPendingTotal: rows.filter(isStatedPending).reduce((s, e) => s + e.amountUsd, 0),
      pendingCount: rows.filter(e => e.needsOwnerConfirmation).length,
      entryCount: rows.length,
      auditRun: rows.find(e => e.auditRun)?.auditRun ?? null,
      hasAudit: true,
      book,
      bookTotals,
      hasData: true,
    };
  }, [rawRows, bookRows]);

  return { data, loading: isLoading || bookLoading, error: error?.message ?? null };
}
