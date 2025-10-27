import { supabase } from '../lib/supabase';
import type { ParsedReceipt } from './receiptExtractionService';

export class ReceiptPersistService {
  static async saveForVehicleDoc(params: {
    vehicleId: string;
    documentId: string;
    parsed: ParsedReceipt;
  }): Promise<{ id?: string; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { parsed } = params;
      const { data: receipt, error: recErr } = await supabase
        .from('receipts')
        .insert({
          scope_type: 'vehicle',
          scope_id: params.vehicleId,
          source_document_table: 'vehicle_documents',
          source_document_id: params.documentId,
          vendor_name: parsed.vendor_name || null,
          receipt_date: parsed.receipt_date || null,
          currency: parsed.currency || 'USD',
          subtotal: parsed.subtotal ?? null,
          tax: parsed.tax ?? null,
          total: parsed.total ?? null,
          payment_method: parsed.payment_method || null,
          card_last4: parsed.card_last4 || null,
          card_holder: parsed.card_holder || null,
          invoice_number: parsed.invoice_number || null,
          purchase_order: parsed.purchase_order || null,
          raw_json: parsed.raw_json || parsed,
          status: 'processed',
          created_by: user.id
        })
        .select('id')
        .single();

      if (recErr) throw recErr;

      const items = parsed.items || [];
      if (items.length > 0) {
        // Simple auto-categorization for parts to power valuation categories
        const autoCategory = (desc?: string, existing?: string | null) => {
          if (existing) return existing;
          const d = (desc || '').toLowerCase();
          if (/engine|motor|intake|exhaust|radiator|coolant|filter|spark/.test(d)) return 'Engine';
          if (/brake|pad|rotor|caliper|master/.test(d)) return 'Brakes';
          if (/suspension|shock|spring|coilover|strut/.test(d)) return 'Suspension';
          if (/transmission|clutch|gear|drivetrain/.test(d)) return 'Transmission';
          if (/tire|wheel|rim/.test(d)) return 'Wheels & Tires';
          if (/body|panel|fender|hood|bumper|paint|wrap/.test(d)) return 'Body/Paint';
          if (/interior|seat|trim|dash|carpet|stereo/.test(d)) return 'Interior';
          if (/electrical|wiring|harness|battery|alternator/.test(d)) return 'Electrical';
          return null;
        };
        const rows = items.map((it, idx) => ({
          receipt_id: receipt.id,
          line_number: it.line_number ?? idx + 1,
          description: it.description || null,
          part_number: it.part_number || null,
          vendor_sku: it.vendor_sku || null,
          category: autoCategory(it.description, it.category) || null,
          quantity: it.quantity ?? null,
          unit_price: it.unit_price ?? null,
          total_price: it.total_price ?? null
        }));
        const { error: itemErr } = await supabase.from('receipt_items').insert(rows);
        if (itemErr) throw itemErr;
      }

      // Trigger valuation refresh events for this vehicle
      try { window.dispatchEvent(new CustomEvent('valuation_updated', { detail: { vehicleId: params.vehicleId } } as any)); } catch {}
      try { window.dispatchEvent(new CustomEvent('timeline_updated', { detail: { vehicleId: params.vehicleId } } as any)); } catch {}
      return { id: receipt.id };
    } catch (e: any) {
      return { error: e?.message || 'Failed to save receipt' };
    }
  }

  static async saveForOrgDoc(params: {
    shopId: string;
    documentId: string;
    parsed: ParsedReceipt;
  }): Promise<{ id?: string; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { parsed } = params;
      const { data: receipt, error: recErr } = await supabase
        .from('receipts')
        .insert({
          scope_type: 'org',
          scope_id: params.shopId,
          source_document_table: 'shop_documents',
          source_document_id: params.documentId,
          vendor_name: parsed.vendor_name || null,
          receipt_date: parsed.receipt_date || null,
          currency: parsed.currency || 'USD',
          subtotal: parsed.subtotal ?? null,
          tax: parsed.tax ?? null,
          total: parsed.total ?? null,
          payment_method: parsed.payment_method || null,
          card_last4: parsed.card_last4 || null,
          card_holder: parsed.card_holder || null,
          invoice_number: parsed.invoice_number || null,
          purchase_order: parsed.purchase_order || null,
          raw_json: parsed.raw_json || parsed,
          status: 'processed',
          created_by: user.id
        })
        .select('id')
        .single();

      if (recErr) throw recErr;

      const items = parsed.items || [];
      if (items.length > 0) {
        const rows = items.map((it, idx) => ({
          receipt_id: receipt.id,
          line_number: it.line_number ?? idx + 1,
          description: it.description || null,
          part_number: it.part_number || null,
          vendor_sku: it.vendor_sku || null,
          category: it.category || null,
          quantity: it.quantity ?? null,
          unit_price: it.unit_price ?? null,
          total_price: it.total_price ?? null
        }));
        const { error: itemErr } = await supabase.from('receipt_items').insert(rows);
        if (itemErr) throw itemErr;
      }

      return { id: receipt.id };
    } catch (e: any) {
      return { error: e?.message || 'Failed to save receipt' };
    }
  }
}

export const receiptPersistService = ReceiptPersistService;
