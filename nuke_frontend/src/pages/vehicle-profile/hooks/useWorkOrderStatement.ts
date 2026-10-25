/**
 * useWorkOrderStatement — data hook for the editable invoice (owner view)
 *
 * One read: work_order_statement_read (open statement; payments, balances, payment
 * instructions and notes only for the viewer's own work orders; no contact fields).
 * Lookup is by work order id, vehicle id or public handle, never by name or e-mail.
 *
 * Mutations follow UniversalFieldEditor auto-save pattern:
 * DB write → confirmed local update → recalc totals
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { supabase } from '../../../lib/supabase';

// ── Types ──

export interface StatementVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
  text: string | null;
}

/** Contact is brokered by Nuke; the statement never carries contact fields. */
export interface StatementContact {
  action: 'contact_via_nuke';
  available: boolean;
  basis: string;
}

export interface StatementMatch {
  vehicle_id: string;
  vehicle_label: { year: number | null; make: string | null; model: string | null; trim: string | null; text: string | null } | null;
}

export interface PartRow {
  id: string;
  work_order_id: string;
  part_name: string;
  part_number: string | null;
  brand: string | null;
  category: string | null;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  supplier: string | null;
  buy_url: string | null;
  notes: string | null;
  status: string | null;
  ai_extracted: boolean;
  user_verified: boolean;
  is_comped: boolean;
  comp_reason: string | null;
  comp_retail_value: number | null;
  is_taxable: boolean;
  created_at: string;
}

export interface LaborRow {
  id: string;
  work_order_id: string;
  task_name: string;
  task_category: string | null;
  hours: number;
  hourly_rate: number | null;
  total_cost: number | null;
  rate_source: string | null;
  notes: string | null;
  status: string | null;
  ai_estimated: boolean;
  is_comped: boolean;
  comp_reason: string | null;
  comp_retail_value: number | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  work_order_id: string;
  amount: number;
  payment_method: string;
  sender_name: string | null;
  memo: string | null;
  reference_id: string | null;
  payment_date: string;
  source: string;
  source_metadata: Record<string, any> | null;
  status: string;
  created_at: string;
}

export interface WorkOrderSummary {
  id: string;
  title: string;
  status: string;
  created_at: string;
  notes: string | null;
  parts_total: number;
  labor_total: number;
  payments_total: number;
  comped_value: number;
  balance_due: number;
}

export interface StatementTotals {
  parts: number;
  labor: number;
  subtotal: number;
  payments: number;
  balance: number;
  goodwill: number;
}

export interface ShopInfo {
  name: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  tax_rate: number | null;
  payment_methods: Array<{ method: string; label: string; detail: string; note?: string }> | null;
}

export interface StatementData {
  vehicle: StatementVehicle;
  contact: StatementContact | null;
  shop: ShopInfo | null;
  workOrders: WorkOrderSummary[];
  parts: Record<string, PartRow[]>;
  labor: Record<string, LaborRow[]>;
  payments: Record<string, PaymentRow[]>;
  totals: StatementTotals;
  /** True only when the viewer is a party to every work order shown (payments are party-only). */
  moneyVisible: boolean;
}

type StatementResult = StatementData | { matches: StatementMatch[] };

type Num = number | string | null | undefined;

interface RawWorkOrder {
  id: string;
  display_title?: string | null;
  title?: string | null;
  status: string;
  created_at: string;
  notes: string | null;
  money_visible?: boolean;
  parts?: PartRow[];
  labor?: LaborRow[];
  payments?: PaymentRow[] | null;
  parts_total?: Num;
  labor_total?: Num;
  payments_total?: Num;
  comped_value?: Num;
  balance_due?: Num;
}

interface RawStatement {
  error?: string;
  matches?: StatementMatch[];
  vehicle?: StatementVehicle;
  contact?: StatementContact | null;
  shop?: ShopInfo | null;
  work_orders?: RawWorkOrder[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lookup keys: `wo:<uuid>`, `vehicle:<uuid>`, `handle:<name>`, or a bare uuid / @handle. */
export async function readStatement(query: string): Promise<RawStatement | null> {
  const [kind, ...rest] = query.includes(':') ? query.split(':') : ['', query];
  const key = (rest.length ? rest.join(':') : kind).trim();
  const call = (args: Record<string, string>) => supabase.rpc('work_order_statement_read', args);
  let res;
  if (kind === 'wo') res = await call({ p_work_order_id: key });
  else if (kind === 'vehicle') res = await call({ p_vehicle_id: key });
  else if (kind === 'handle' || !UUID_RE.test(key)) res = await call({ p_handle: key.replace(/^@/, '') });
  else {
    res = await call({ p_work_order_id: key });
    if (!res.error && res.data?.error === 'no_match') res = await call({ p_vehicle_id: key });
  }
  if (res.error) throw new Error(res.error.message);
  return res.data as RawStatement | null;
}

type EditableTable = 'work_order_parts' | 'work_order_labor' | 'work_order_payments';

function requireChangedRow(count: number | null) {
  if (count === 1) return;
  throw new Error(count === 0
    ? 'No record was changed. Reload the statement and check your access before retrying.'
    : 'The saved change could not be confirmed. Reload the statement before retrying.');
}

// ── Hook ──

export function useWorkOrderStatement(query: string | null) {
  const queryClient = useQueryClient();
  const { user, loading: authLoading } = useAuth();
  const queryKey = useMemo(() => ['work-order-statement', query, user?.id ?? 'anonymous'], [query, user?.id]);
  const scope = useMemo(() => ({ query, viewerId: user?.id, authLoading }), [query, user?.id, authLoading]);
  const activeScope = useRef<object | null>(scope);
  activeScope.current = scope;
  useEffect(() => {
    activeScope.current = scope;
    return () => { if (activeScope.current === scope) activeScope.current = null; };
  }, [scope]);

  const { data: queryResult, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<StatementResult | null> => {
      if (!query) return null;

      const rpcData = await readStatement(query);
      // Consuming the query signal cancels obsolete results, including their cache writes.
      if (signal.aborted) throw new Error('Statement read cancelled.');
      if (!rpcData || rpcData.error) return null;
      if (Array.isArray(rpcData.matches)) return { matches: rpcData.matches as StatementMatch[] };

      const woArray = rpcData.work_orders || [];
      if (woArray.length === 0) return null;
      const vehicle = rpcData.vehicle as StatementVehicle;
      const contact = rpcData.contact || null;
      const shop = rpcData.shop || null;

      const parts: Record<string, PartRow[]> = {};
      const labor: Record<string, LaborRow[]> = {};
      const payments: Record<string, PaymentRow[]> = {};

      for (const wo of woArray) {
        parts[wo.id] = (wo.parts || []).map((p) => ({
          ...p,
          quantity: Number(p.quantity) || 1,
          unit_price: p.unit_price != null ? Number(p.unit_price) : null,
          total_price: p.total_price != null ? Number(p.total_price) : null,
          comp_retail_value: p.comp_retail_value != null ? Number(p.comp_retail_value) : null,
          is_comped: !!p.is_comped,
          is_taxable: !!p.is_taxable,
        }));
        labor[wo.id] = (wo.labor || []).map((l) => ({
          ...l,
          hours: Number(l.hours) || 0,
          hourly_rate: l.hourly_rate != null ? Number(l.hourly_rate) : null,
          total_cost: l.total_cost != null ? Number(l.total_cost) : null,
          comp_retail_value: l.comp_retail_value != null ? Number(l.comp_retail_value) : null,
          is_comped: !!l.is_comped,
        }));
        payments[wo.id] = (wo.payments || []).map((pm) => ({ ...pm, amount: Number(pm.amount) || 0 }));
      }

      const workOrders: WorkOrderSummary[] = woArray.map((wo) => ({
        id: wo.id,
        title: wo.display_title ?? wo.title ?? '',
        status: wo.status,
        created_at: wo.created_at,
        notes: wo.notes,
        parts_total: Number(wo.parts_total) || 0,
        labor_total: Number(wo.labor_total) || 0,
        payments_total: Number(wo.payments_total) || 0,
        comped_value: Number(wo.comped_value) || 0,
        balance_due: Number(wo.balance_due) || 0,
      }));

      const moneyVisible = woArray.every((wo) => wo.money_visible === true);
      return { vehicle, contact, shop, workOrders, parts, labor, payments, totals: calcTotals(parts, labor, payments), moneyVisible };
    },
    enabled: !!query && !authLoading,
    staleTime: 5 * 60 * 1000,
  });
  const result = authLoading ? undefined : queryResult;
  const data: StatementData | null = result && 'vehicle' in result ? result : null;
  const matches: StatementMatch[] | null = result && 'matches' in result ? result.matches : null;

  // ── Mutations ──

  const updateField = useCallback(async (
    table: EditableTable, id: string, field: string, value: any
  ) => {
    // Get old value for audit log
    const oldValue = getOldValue(data, table, id, field);

    // Get current user
    const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();
    if (userError) throw userError;
    if (activeScope.current !== scope || !user || currentUser?.id !== user.id) throw new Error('The viewer changed. Reopen the statement before saving.');

    const { error, count } = await supabase
      .from(table)
      .update({
        [field]: value,
        updated_by: currentUser.id,
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('id', id);

    if (error) throw error;
    requireChangedRow(count);
    // Reflect the change only after the existing writer accepts it, in its original scope.
    if (activeScope.current === scope) {
      queryClient.setQueryData<StatementResult | null>(queryKey, (old) => {
        if (!old || !('vehicle' in old)) return old;
        return applyFieldUpdate(old, table, id, field, value);
      });
    }

    // Audit log (fire and forget)
    if (user) {
      supabase.from('work_order_edit_log').insert({
        table_name: table,
        row_id: id,
        field_name: field,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: value != null ? String(value) : null,
        edited_by: user.id,
        source: 'inline_edit',
      }).then(({ error: logErr }) => {
        if (logErr) console.error('Audit log failed:', logErr);
      });
    }
  }, [data, queryClient, queryKey, scope, user]);

  const addRow = useCallback(async (
    table: EditableTable, workOrderId: string, defaults: Record<string, any> = {}
  ) => {
    const row: any = { work_order_id: workOrderId, ...defaults };

    if (table === 'work_order_parts') {
      row.part_name = defaults.part_name || 'New Part';
      row.quantity = defaults.quantity || 1;
      row.unit_price = defaults.unit_price || 0;
      row.total_price = defaults.total_price || 0;
      row.status = 'ordered';
      row.is_comped = false;
    } else if (table === 'work_order_labor') {
      row.task_name = defaults.task_name || 'New Task';
      row.hours = defaults.hours || 0;
      row.hourly_rate = defaults.hourly_rate || 0;
      row.total_cost = defaults.total_cost || 0;
      row.is_comped = false;
    } else if (table === 'work_order_payments') {
      row.amount = defaults.amount || 0;
      row.payment_method = defaults.payment_method || 'other';
      row.payment_date = defaults.payment_date || new Date().toISOString();
      row.source = 'manual';
      row.status = 'completed';
    }

    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select()
      .single();

    if (error) throw error;

    // A late result cannot refresh another viewer's statement.
    if (activeScope.current === scope) refetch();
    return data;
  }, [refetch, scope]);

  const deleteRow = useCallback(async (table: EditableTable, id: string) => {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('id', id);

    if (error) throw error;
    requireChangedRow(count);
    if (activeScope.current !== scope) return;
    // Remove locally only after the existing writer accepts it.
    queryClient.setQueryData<StatementResult | null>(queryKey, (old) => {
      if (!old || !('vehicle' in old)) return old;
      return applyRowDelete(old, table, id);
    });
  }, [queryClient, queryKey, scope]);

  const toggleComp = useCallback(async (table: 'work_order_parts' | 'work_order_labor', id: string) => {
    const old = data;
    if (!old) return;

    // Find current row
    let currentIsComped = false;
    let currentPrice = 0;

    if (table === 'work_order_parts') {
      for (const rows of Object.values(old.parts)) {
        const row = rows.find(r => r.id === id);
        if (row) {
          currentIsComped = row.is_comped;
          currentPrice = row.total_price || (row.unit_price || 0) * (row.quantity || 1);
          break;
        }
      }
    } else {
      for (const rows of Object.values(old.labor)) {
        const row = rows.find(r => r.id === id);
        if (row) {
          currentIsComped = row.is_comped;
          currentPrice = row.total_cost || 0;
          break;
        }
      }
    }

    const newIsComped = !currentIsComped;
    const updates: Record<string, any> = {
      is_comped: newIsComped,
    };
    if (newIsComped) {
      updates.comp_retail_value = currentPrice;
    }

    const { error, count } = await supabase
      .from(table)
      .update(updates, { count: 'exact' })
      .eq('id', id);

    if (error) throw error;
    requireChangedRow(count);
    if (activeScope.current !== scope) return;
    // Reflect the comp only after the existing writer accepts it.
    queryClient.setQueryData<StatementResult | null>(queryKey, (prev) => {
      if (!prev || !('vehicle' in prev)) return prev;
      let updated = applyFieldUpdate(prev, table, id, 'is_comped', newIsComped);
      if (newIsComped) {
        updated = applyFieldUpdate(updated!, table, id, 'comp_retail_value', currentPrice);
      }
      return updated;
    });
  }, [data, queryClient, queryKey, scope]);

  return {
    data,
    matches,
    loading: authLoading || isLoading,
    error: error?.message ?? null,
    refetch,
    updateField,
    addRow,
    deleteRow,
    toggleComp,
  };
}

// ── Helpers ──

function calcTotals(
  parts: Record<string, PartRow[]>,
  labor: Record<string, LaborRow[]>,
  payments: Record<string, PaymentRow[]>,
): StatementTotals {
  let partsTotal = 0;
  let goodwill = 0;

  for (const rows of Object.values(parts)) {
    for (const p of rows) {
      if (p.is_comped) {
        goodwill += p.comp_retail_value || p.total_price || (p.unit_price || 0) * (p.quantity || 1);
      } else {
        partsTotal += p.total_price || 0;
      }
    }
  }

  let laborTotal = 0;
  for (const rows of Object.values(labor)) {
    for (const l of rows) {
      if (l.is_comped) {
        goodwill += l.comp_retail_value || l.total_cost || 0;
      } else {
        laborTotal += l.total_cost || 0;
      }
    }
  }

  let paymentsTotal = 0;
  for (const rows of Object.values(payments)) {
    for (const pm of rows) {
      if (pm.status === 'completed') {
        paymentsTotal += pm.amount;
      }
    }
  }

  const subtotal = partsTotal + laborTotal;
  return {
    parts: partsTotal,
    labor: laborTotal,
    subtotal,
    payments: paymentsTotal,
    balance: subtotal - paymentsTotal,
    goodwill,
  };
}

function applyFieldUpdate(
  state: StatementData, table: EditableTable, id: string, field: string, value: any
): StatementData {
  const next = { ...state };

  if (table === 'work_order_parts') {
    const newParts = { ...next.parts };
    for (const woId of Object.keys(newParts)) {
      newParts[woId] = newParts[woId].map(row =>
        row.id === id ? { ...row, [field]: value } : row
      );
    }
    next.parts = newParts;
  } else if (table === 'work_order_labor') {
    const newLabor = { ...next.labor };
    for (const woId of Object.keys(newLabor)) {
      newLabor[woId] = newLabor[woId].map(row =>
        row.id === id ? { ...row, [field]: value } : row
      );
    }
    next.labor = newLabor;
  } else if (table === 'work_order_payments') {
    const newPayments = { ...next.payments };
    for (const woId of Object.keys(newPayments)) {
      newPayments[woId] = newPayments[woId].map(row =>
        row.id === id ? { ...row, [field]: value } : row
      );
    }
    next.payments = newPayments;
  }

  next.totals = calcTotals(next.parts, next.labor, next.payments);
  return next;
}

function getOldValue(
  state: StatementData | null, table: EditableTable, id: string, field: string
): any {
  if (!state) return null;
  if (table === 'work_order_parts') {
    for (const rows of Object.values(state.parts)) {
      const row = rows.find(r => r.id === id);
      if (row) return (row as any)[field];
    }
  } else if (table === 'work_order_labor') {
    for (const rows of Object.values(state.labor)) {
      const row = rows.find(r => r.id === id);
      if (row) return (row as any)[field];
    }
  } else if (table === 'work_order_payments') {
    for (const rows of Object.values(state.payments)) {
      const row = rows.find(r => r.id === id);
      if (row) return (row as any)[field];
    }
  }
  return null;
}

function applyRowDelete(
  state: StatementData, table: EditableTable, id: string
): StatementData {
  const next = { ...state };

  if (table === 'work_order_parts') {
    const newParts = { ...next.parts };
    for (const woId of Object.keys(newParts)) {
      newParts[woId] = newParts[woId].filter(row => row.id !== id);
    }
    next.parts = newParts;
  } else if (table === 'work_order_labor') {
    const newLabor = { ...next.labor };
    for (const woId of Object.keys(newLabor)) {
      newLabor[woId] = newLabor[woId].filter(row => row.id !== id);
    }
    next.labor = newLabor;
  } else if (table === 'work_order_payments') {
    const newPayments = { ...next.payments };
    for (const woId of Object.keys(newPayments)) {
      newPayments[woId] = newPayments[woId].filter(row => row.id !== id);
    }
    next.payments = newPayments;
  }

  next.totals = calcTotals(next.parts, next.labor, next.payments);
  return next;
}
