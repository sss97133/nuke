import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';

// ── Types ──

export interface WorkSession {
  date: string;
  title: string;
  work_type: string;
  image_count: number;
  duration_minutes: number;
  total_parts_cost: number;
  has_receipts: boolean;
  work_description: string;
  status: string;
}

export interface WorkDatesResponse {
  vehicle_id: string;
  date_range: { start: string; end: string };
  total_sessions: number;
  total_photos: number;
  total_parts_spend: number;
  sessions: WorkSession[];
}

export interface DayPhoto {
  id: string;
  image_url: string;
  thumbnail_url: string;
  taken_at: string;
  source: string;
  file_name: string;
  area: string | null;
  part: string | null;
  operation: string | null;
  fabrication_stage: string | null;
  image_type: string | null;
  category: string | null;
  caption: string | null;
}

export interface DayReceipt {
  id: string;
  vendor_name: string;
  receipt_date: string;
  total: number;
  total_amount: number;
  items: any[] | null;
  order_number: string | null;
  payment_method: string | null;
}

export interface DayComponentEvent {
  id: string;
  event_type: string;
  event_date: string;
  description: string;
  component_table: string | null;
  cost_cents: number | null;
  work_order_id: string | null;
}

export interface DayLineItem {
  line_number: number;
  task_type: string;
  task_description: string;
  hours_labor: number | null;
  parts_cost_cents: number | null;
  total_cost_cents: number | null;
  status: string;
  notes: string | null;
}

export interface DaySessionInfo {
  id: string;
  title: string;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number;
  work_type: string;
  work_description: string;
  status: string;
  total_parts_cost: number;
  total_labor_cost: number;
  total_job_cost: number;
  image_count: number;
}

export interface DailyReceipt {
  receipt_date: string;
  vehicle: any;
  work_session: DaySessionInfo | null;
  photos: DayPhoto[];
  photo_count: number;
  receipts: DayReceipt[];
  parts_count: number;
  parts_total: number;
  component_events: DayComponentEvent[];
  line_items: DayLineItem[];
  summary: {
    has_photos: boolean;
    has_parts: boolean;
    has_events: boolean;
    has_session: boolean;
    activity_level: string;
  };
}

// ── Hook ──

export function useBuildLog(vehicleId: string | undefined) {
  const [workDates, setWorkDates] = useState<WorkDatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cache for day details
  const [dayDetails, setDayDetails] = useState<Record<string, DailyReceipt>>({});
  const [loadingDays, setLoadingDays] = useState<Set<string>>(new Set());
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!vehicleId || vehicleId.length < 20) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_vehicle_work_dates', {
          p_vehicle_id: vehicleId,
        });
        if (cancelled) return;
        if (rpcError) throw rpcError;
        setWorkDates(data as WorkDatesResponse);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load work dates');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [vehicleId]);

  const loadDayDetail = useCallback(async (date: string) => {
    if (!vehicleId || loadedRef.current.has(date)) return;
    loadedRef.current.add(date);
    setLoadingDays(prev => new Set(prev).add(date));

    try {
      const { data, error: rpcError } = await supabase.rpc('get_daily_work_receipt', {
        p_vehicle_id: vehicleId,
        p_date: date,
      });
      if (rpcError) throw rpcError;
      setDayDetails(prev => ({ ...prev, [date]: data as DailyReceipt }));
    } catch {
      // Allow retry
      loadedRef.current.delete(date);
    } finally {
      setLoadingDays(prev => {
        const next = new Set(prev);
        next.delete(date);
        return next;
      });
    }
  }, [vehicleId]);

  return {
    workDates,
    loading,
    error,
    dayDetails,
    loadingDays,
    loadDayDetail,
  };
}
