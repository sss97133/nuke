import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../../lib/supabase';

export interface WorkOrderReceipt {
  work_order_id: string;
  vehicle_id: string;
  work_order_title: string;
  work_order_status: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  work_order_created: string;
  notes: string | null;
  parts_total: number;
  parts_count: number;
  comped_parts_value: number;
  comped_parts_count: number;
  labor_total: number;
  labor_count: number;
  labor_hours: number;
  comped_labor_value: number;
  comped_labor_count: number;
  payments_total: number;
  payment_count: number;
  invoice_total: number;
  balance_due: number;
  total_comped_value: number;
}

export interface DealContact {
  full_name: string;
  email: string | null;
  phone_mobile: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  profile_image_url: string | null;
}

export interface DealJacket {
  sale_price_inc_doc: number | null;
  deposit_amount: number | null;
  payment_amount: number | null;
  sold_date: string | null;
  contact: DealContact | null;
}

export interface BuildStatusTotals {
  invoice: number;
  paid: number;
  balance: number;
  comped: number;
  orderCount: number;
}

export interface BuildStatusData {
  workOrders: WorkOrderReceipt[];
  dealJacket: DealJacket | null;
  totals: BuildStatusTotals;
  hasData: boolean;
}

export function useBuildStatus(vehicleId: string | undefined) {
  const { data: rawData, isLoading, error } = useQuery({
    queryKey: ['build-status', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;

      const [receiptsRes, dealRes] = await Promise.all([
        supabase
          .from('work_order_receipt_unified')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('work_order_created'),
        supabase
          .from('deal_jackets')
          .select('sale_price_inc_doc, deposit_amount, payment_amount, sold_date, deal_contacts!deal_jackets_sold_to_id_fkey(full_name, email, phone_mobile, address, city, state, zip, profile_image_url)')
          .eq('vehicle_id', vehicleId)
          .maybeSingle(),
      ]);

      if (receiptsRes.error) throw new Error(receiptsRes.error.message);
      if (dealRes.error) throw new Error(dealRes.error.message);

      // Parse numeric strings from the view
      const workOrders = (receiptsRes.data || []).map((r: any) => ({
        ...r,
        parts_total: Number(r.parts_total) || 0,
        parts_count: Number(r.parts_count) || 0,
        comped_parts_value: Number(r.comped_parts_value) || 0,
        comped_parts_count: Number(r.comped_parts_count) || 0,
        labor_total: Number(r.labor_total) || 0,
        labor_count: Number(r.labor_count) || 0,
        labor_hours: Number(r.labor_hours) || 0,
        comped_labor_value: Number(r.comped_labor_value) || 0,
        comped_labor_count: Number(r.comped_labor_count) || 0,
        payments_total: Number(r.payments_total) || 0,
        payment_count: Number(r.payment_count) || 0,
        invoice_total: Number(r.invoice_total) || 0,
        balance_due: Number(r.balance_due) || 0,
        total_comped_value: Number(r.total_comped_value) || 0,
      })) as WorkOrderReceipt[];

      // Flatten nested deal_contacts join
      let dealJacket: DealJacket | null = null;
      if (dealRes.data) {
        const d = dealRes.data as any;
        const contact = d.deal_contacts;
        dealJacket = {
          sale_price_inc_doc: d.sale_price_inc_doc != null ? Number(d.sale_price_inc_doc) : null,
          deposit_amount: d.deposit_amount != null ? Number(d.deposit_amount) : null,
          payment_amount: d.payment_amount != null ? Number(d.payment_amount) : null,
          sold_date: d.sold_date,
          contact: contact ? {
            full_name: contact.full_name,
            email: contact.email,
            phone_mobile: contact.phone_mobile,
            address: contact.address,
            city: contact.city,
            state: contact.state,
            zip: contact.zip,
            profile_image_url: contact.profile_image_url,
          } : null,
        };
      }

      return { workOrders, dealJacket };
    },
    enabled: !!vehicleId && vehicleId.length >= 20,
    staleTime: 10 * 60 * 1000, // 10 min
  });

  const workOrders = rawData?.workOrders ?? [];
  const dealJacket = rawData?.dealJacket ?? null;

  const totals = useMemo<BuildStatusTotals>(() => {
    const invoice = workOrders.reduce((s, w) => s + w.invoice_total, 0);
    const paid = workOrders.reduce((s, w) => s + w.payments_total, 0);
    const balance = workOrders.reduce((s, w) => s + w.balance_due, 0);
    const comped = workOrders.reduce((s, w) => s + w.total_comped_value, 0);
    return { invoice, paid, balance, comped, orderCount: workOrders.length };
  }, [workOrders]);

  const hasData = workOrders.length > 0 || dealJacket !== null;

  return {
    data: hasData ? { workOrders, dealJacket, totals, hasData } as BuildStatusData : null,
    loading: isLoading,
    error: error?.message ?? null,
  };
}
