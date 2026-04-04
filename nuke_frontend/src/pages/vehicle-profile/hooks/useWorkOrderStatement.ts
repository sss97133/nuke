/**
 * useWorkOrderStatement — data hook for the editable invoice (owner view)
 *
 * Two-step load:
 * 1. resolve_work_order_status RPC → vehicle, contact, work order IDs, summary
 * 2. Three parallel SELECTs for full editable rows with IDs
 *
 * Mutations follow UniversalFieldEditor auto-save pattern:
 * optimistic state → DB write → recalc totals
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';

// ── Types ──

export interface StatementVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  sale_price: number | null;
}

export interface StatementContact {
  name: string | null;
  email: string | null;
  phone: string | null;
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

export interface StatementData {
  vehicle: StatementVehicle;
  contact: StatementContact | null;
  workOrders: WorkOrderSummary[];
  parts: Record<string, PartRow[]>;
  labor: Record<string, LaborRow[]>;
  payments: Record<string, PaymentRow[]>;
  totals: StatementTotals;
}

type EditableTable = 'work_order_parts' | 'work_order_labor' | 'work_order_payments';

// ── Hook ──

export function useWorkOrderStatement(query: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['work-order-statement', query];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<StatementData | null> => {
      if (!query) return null;

      // Step 1: RPC to resolve vehicle + work orders
      const { data: rpcData, error: rpcError } = await supabase
        .rpc('resolve_work_order_status', { p_query: query });

      if (rpcError) throw new Error(rpcError.message);
      if (!rpcData || rpcData.error) return null;

      const vehicle = rpcData.vehicle as StatementVehicle;
      const contact = rpcData.contact as StatementContact | null;
      const woArray = (rpcData.work_orders || []) as any[];
      const woIds = woArray.map((wo: any) => wo.id);

      if (woIds.length === 0) return null;

      // Step 2: Three parallel SELECTs for full editable rows
      const [partsRes, laborRes, paymentsRes] = await Promise.all([
        supabase.from('work_order_parts')
          .select('*')
          .in('work_order_id', woIds)
          .neq('status', 'cancelled')
          .order('created_at'),
        supabase.from('work_order_labor')
          .select('*')
          .in('work_order_id', woIds)
          .order('created_at'),
        supabase.from('work_order_payments')
          .select('*')
          .in('work_order_id', woIds)
          .order('payment_date'),
      ]);

      if (partsRes.error) throw new Error(partsRes.error.message);
      if (laborRes.error) throw new Error(laborRes.error.message);
      if (paymentsRes.error) throw new Error(paymentsRes.error.message);

      // Group by work_order_id
      const parts: Record<string, PartRow[]> = {};
      const labor: Record<string, LaborRow[]> = {};
      const payments: Record<string, PaymentRow[]> = {};

      for (const p of (partsRes.data || [])) {
        const woId = p.work_order_id;
        if (!parts[woId]) parts[woId] = [];
        parts[woId].push({
          ...p,
          quantity: Number(p.quantity) || 1,
          unit_price: p.unit_price != null ? Number(p.unit_price) : null,
          total_price: p.total_price != null ? Number(p.total_price) : null,
          comp_retail_value: p.comp_retail_value != null ? Number(p.comp_retail_value) : null,
          is_comped: !!p.is_comped,
          is_taxable: !!p.is_taxable,
        });
      }

      for (const l of (laborRes.data || [])) {
        const woId = l.work_order_id;
        if (!labor[woId]) labor[woId] = [];
        labor[woId].push({
          ...l,
          hours: Number(l.hours) || 0,
          hourly_rate: l.hourly_rate != null ? Number(l.hourly_rate) : null,
          total_cost: l.total_cost != null ? Number(l.total_cost) : null,
          comp_retail_value: l.comp_retail_value != null ? Number(l.comp_retail_value) : null,
          is_comped: !!l.is_comped,
        });
      }

      for (const pm of (paymentsRes.data || [])) {
        const woId = pm.work_order_id;
        if (!payments[woId]) payments[woId] = [];
        payments[woId].push({
          ...pm,
          amount: Number(pm.amount) || 0,
        });
      }

      const workOrders: WorkOrderSummary[] = woArray.map((wo: any) => ({
        id: wo.id,
        title: wo.title,
        status: wo.status,
        created_at: wo.created_at,
        notes: wo.notes,
        parts_total: Number(wo.parts_total) || 0,
        labor_total: Number(wo.labor_total) || 0,
        payments_total: Number(wo.payments_total) || 0,
        comped_value: Number(wo.comped_value) || 0,
        balance_due: Number(wo.balance_due) || 0,
      }));

      return { vehicle, contact, workOrders, parts, labor, payments, totals: calcTotals(parts, labor, payments) };
    },
    enabled: !!query,
    staleTime: 5 * 60 * 1000,
  });

  // ── Mutations ──

  const updateField = useCallback(async (
    table: EditableTable, id: string, field: string, value: any
  ) => {
    // Get old value for audit log
    const oldValue = getOldValue(data, table, id, field);

    // Optimistic update
    queryClient.setQueryData<StatementData | null>(queryKey, (old) => {
      if (!old) return old;
      return applyFieldUpdate(old, table, id, field, value);
    });

    // Get current user
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from(table)
      .update({
        [field]: value,
        updated_by: user?.id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      refetch();
      throw error;
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
  }, [data, queryClient, queryKey, refetch]);

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

    // Add to state
    refetch();
    return data;
  }, [refetch]);

  const deleteRow = useCallback(async (table: EditableTable, id: string) => {
    // Optimistic remove
    queryClient.setQueryData<StatementData | null>(queryKey, (old) => {
      if (!old) return old;
      return applyRowDelete(old, table, id);
    });

    const { error } = await supabase
      .from(table)
      .delete()
      .eq('id', id);

    if (error) {
      refetch();
      throw error;
    }
  }, [queryClient, queryKey, refetch]);

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

    // Optimistic
    queryClient.setQueryData<StatementData | null>(queryKey, (prev) => {
      if (!prev) return prev;
      let updated = applyFieldUpdate(prev, table, id, 'is_comped', newIsComped);
      if (newIsComped) {
        updated = applyFieldUpdate(updated!, table, id, 'comp_retail_value', currentPrice);
      }
      return updated;
    });

    const { error } = await supabase
      .from(table)
      .update(updates)
      .eq('id', id);

    if (error) {
      refetch();
      throw error;
    }
  }, [data, queryClient, queryKey, refetch]);

  return {
    data: data ?? null,
    loading: isLoading,
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
