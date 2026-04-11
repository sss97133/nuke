import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import type { WorkOrderReceipt, VehicleReceipt, DealContact } from './useBuildStatus';

export interface DealJacketRow {
  id: string;
  sold_date: string | null;
  sale_price_inc_doc: number | null;
  initial_cost: number | null;
  deposit_amount: number | null;
  payment_amount: number | null;
  buyer: DealContact | null;
  seller: DealContact | null;
}

export interface OwnerEpoch {
  index: number;
  ownerName: string;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  acquisitionCost: number | null;
  salePrice: number | null;
  workOrders: WorkOrderReceipt[];
  receipts: VehicleReceipt[];
  totalInvested: number;
  totalPaid: number;
  balanceDue: number;
  totalComped: number;
  profitLoss: number | null;
  roiPercent: number | null;
  dealJacket: DealJacketRow | null;
  contact: DealContact | null;
}

export interface InvestmentLedgerData {
  epochs: OwnerEpoch[];
  grandTotals: { totalIn: number; totalSales: number; netPosition: number };
  hasData: boolean;
}

function parseNum(v: any): number {
  return v != null ? Number(v) || 0 : 0;
}

export function useInvestmentLedger(vehicleId: string | undefined) {
  const { data: rawData, isLoading, error } = useQuery({
    queryKey: ['investment-ledger', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return null;

      const [dealRes, woRes, receiptsRes, vehicleRes] = await Promise.all([
        // All deal jackets for this vehicle, ordered by sold_date
        supabase
          .from('deal_jackets')
          .select(`
            id, sold_date, sale_price_inc_doc, initial_cost, deposit_amount, payment_amount,
            deal_contacts!deal_jackets_sold_to_id_fkey(full_name, email, phone_mobile, address, city, state, zip, profile_image_url)
          `)
          .eq('vehicle_id', vehicleId)
          .order('sold_date'),
        // Work orders via the unified view
        supabase
          .from('work_order_receipt_unified')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('work_order_created'),
        // Receipts
        supabase
          .from('receipts')
          .select('id, vendor_name, total, receipt_date, invoice_number')
          .eq('vehicle_id', vehicleId)
          .eq('status', 'processed')
          .order('receipt_date'),
        // Vehicle row for purchase_price, created_at, owner_id
        supabase
          .from('vehicles')
          .select('purchase_price, created_at, owner_id')
          .eq('id', vehicleId)
          .maybeSingle(),
      ]);

      if (dealRes.error) throw new Error(dealRes.error.message);
      if (woRes.error) throw new Error(woRes.error.message);
      if (vehicleRes.error) throw new Error(vehicleRes.error.message);

      // Parse deal jackets
      const dealJackets: DealJacketRow[] = (dealRes.data || []).map((d: any) => ({
        id: d.id,
        sold_date: d.sold_date,
        sale_price_inc_doc: d.sale_price_inc_doc != null ? Number(d.sale_price_inc_doc) : null,
        initial_cost: d.initial_cost != null ? Number(d.initial_cost) : null,
        deposit_amount: d.deposit_amount != null ? Number(d.deposit_amount) : null,
        payment_amount: d.payment_amount != null ? Number(d.payment_amount) : null,
        buyer: d.deal_contacts ? {
          full_name: d.deal_contacts.full_name,
          email: d.deal_contacts.email,
          phone_mobile: d.deal_contacts.phone_mobile,
          address: d.deal_contacts.address,
          city: d.deal_contacts.city,
          state: d.deal_contacts.state,
          zip: d.deal_contacts.zip,
          profile_image_url: d.deal_contacts.profile_image_url,
        } : null,
        seller: null,
      }));

      // Parse work orders
      const workOrders: WorkOrderReceipt[] = (woRes.data || []).map((r: any) => ({
        ...r,
        parts_total: parseNum(r.parts_total),
        parts_count: parseNum(r.parts_count),
        comped_parts_value: parseNum(r.comped_parts_value),
        comped_parts_count: parseNum(r.comped_parts_count),
        labor_total: parseNum(r.labor_total),
        labor_count: parseNum(r.labor_count),
        labor_hours: parseNum(r.labor_hours),
        comped_labor_value: parseNum(r.comped_labor_value),
        comped_labor_count: parseNum(r.comped_labor_count),
        payments_total: parseNum(r.payments_total),
        payment_count: parseNum(r.payment_count),
        invoice_total: parseNum(r.invoice_total),
        balance_due: parseNum(r.balance_due),
        total_comped_value: parseNum(r.total_comped_value),
      }));

      // Parse receipts
      const receipts: VehicleReceipt[] = (receiptsRes.data || []).map((r: any) => ({
        id: r.id,
        vendor_name: r.vendor_name,
        total: parseNum(r.total),
        receipt_date: r.receipt_date,
        invoice_number: r.invoice_number,
      }));

      // Get owner name
      let ownerName = 'Owner';
      if (vehicleRes.data?.owner_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', vehicleRes.data.owner_id)
          .maybeSingle();
        if (profile?.full_name) ownerName = profile.full_name;
      }

      return {
        dealJackets,
        workOrders,
        receipts,
        purchasePrice: vehicleRes.data?.purchase_price != null ? Number(vehicleRes.data.purchase_price) : null,
        createdAt: vehicleRes.data?.created_at ?? null,
        ownerName,
      };
    },
    enabled: !!vehicleId && vehicleId.length >= 20,
    staleTime: 10 * 60 * 1000,
  });

  const data = useMemo<InvestmentLedgerData>(() => {
    if (!rawData) return { epochs: [], grandTotals: { totalIn: 0, totalSales: 0, netPosition: 0 }, hasData: false };

    const { dealJackets, workOrders, receipts, purchasePrice, createdAt, ownerName } = rawData;

    // Build epochs
    const epochs: OwnerEpoch[] = [];

    // Epoch 0: original owner (vehicle.owner)
    const epoch0End = dealJackets.length > 0 ? dealJackets[0].sold_date : null;
    const epoch0Sale = dealJackets.length > 0 ? dealJackets[0].sale_price_inc_doc : null;

    epochs.push({
      index: 0,
      ownerName,
      startDate: createdAt ? createdAt.split('T')[0] : null,
      endDate: epoch0End,
      isCurrent: dealJackets.length === 0,
      acquisitionCost: purchasePrice,
      salePrice: epoch0Sale,
      workOrders: [],
      receipts: [],
      totalInvested: 0,
      totalPaid: 0,
      balanceDue: 0,
      totalComped: 0,
      profitLoss: null,
      roiPercent: null,
      dealJacket: dealJackets.length > 0 ? dealJackets[0] : null,
      contact: null,
    });

    // Epoch N: each subsequent owner
    for (let i = 0; i < dealJackets.length; i++) {
      const dj = dealJackets[i];
      const nextDj = i + 1 < dealJackets.length ? dealJackets[i + 1] : null;
      const buyerName = dj.buyer?.full_name || 'Unknown buyer';

      epochs.push({
        index: i + 1,
        ownerName: buyerName,
        startDate: dj.sold_date,
        endDate: nextDj?.sold_date ?? null,
        isCurrent: nextDj === null,
        acquisitionCost: dj.sale_price_inc_doc,
        salePrice: nextDj?.sale_price_inc_doc ?? null,
        workOrders: [],
        receipts: [],
        totalInvested: 0,
        totalPaid: 0,
        balanceDue: 0,
        totalComped: 0,
        profitLoss: null,
        roiPercent: null,
        dealJacket: nextDj,
        contact: dj.buyer,
      });
    }

    // Attribute work orders to epochs by date
    for (const wo of workOrders) {
      const woDate = wo.work_order_created?.split('T')[0] ?? '';
      let targetIdx = 0;
      for (let i = epochs.length - 1; i >= 0; i--) {
        const ep = epochs[i];
        if (ep.startDate && woDate >= ep.startDate) {
          targetIdx = i;
          break;
        }
      }
      epochs[targetIdx].workOrders.push(wo);
    }

    // Attribute receipts to epochs by date
    for (const r of receipts) {
      const rDate = r.receipt_date ?? '';
      let targetIdx = 0;
      for (let i = epochs.length - 1; i >= 0; i--) {
        const ep = epochs[i];
        if (ep.startDate && rDate >= ep.startDate) {
          targetIdx = i;
          break;
        }
      }
      epochs[targetIdx].receipts.push(r);
    }

    // Compute totals per epoch
    for (const ep of epochs) {
      const woInvoice = ep.workOrders.reduce((s, w) => s + w.invoice_total, 0);
      const woPaid = ep.workOrders.reduce((s, w) => s + w.payments_total, 0);
      const woBalance = ep.workOrders.reduce((s, w) => s + w.balance_due, 0);
      const woComped = ep.workOrders.reduce((s, w) => s + w.total_comped_value, 0);
      const receiptsTotal = ep.receipts.reduce((s, r) => s + r.total, 0);

      ep.totalInvested = woInvoice + receiptsTotal;
      ep.totalPaid = woPaid;
      ep.balanceDue = woBalance;
      ep.totalComped = woComped;

      if (ep.salePrice != null && ep.acquisitionCost != null) {
        ep.profitLoss = ep.salePrice - ep.acquisitionCost - ep.totalInvested;
        if (ep.acquisitionCost > 0) {
          ep.roiPercent = Math.round(((ep.salePrice - ep.acquisitionCost - ep.totalInvested) / ep.acquisitionCost) * 100);
        }
      }
    }

    // Grand totals
    const totalIn = epochs.reduce((s, ep) => s + (ep.acquisitionCost ?? 0) + ep.totalInvested, 0);
    const totalSales = epochs.reduce((s, ep) => s + (ep.salePrice ?? 0), 0);

    const hasData = epochs.some(ep =>
      ep.acquisitionCost != null || ep.salePrice != null || ep.workOrders.length > 0 || ep.receipts.length > 0
    );

    return {
      epochs,
      grandTotals: { totalIn, totalSales, netPosition: totalSales - totalIn },
      hasData,
    };
  }, [rawData]);

  return { data, loading: isLoading, error: error?.message ?? null };
}
