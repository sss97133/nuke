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
      // Resolve the vehicle document so we can satisfy receipts NOT NULL columns (user_id, file_url)
      const { data: vehicleDoc, error: docErr } = await supabase
        .from('vehicle_documents')
        .select('file_url, file_type, title')
        .eq('id', params.documentId)
        .maybeSingle();
      if (docErr) throw docErr;
      const fileUrl = (vehicleDoc as any)?.file_url ? String((vehicleDoc as any).file_url) : null;
      const fileType = (vehicleDoc as any)?.file_type ? String((vehicleDoc as any).file_type) : null;
      const fileName = (vehicleDoc as any)?.title ? String((vehicleDoc as any).title) : null;
      if (!fileUrl) throw new Error('Vehicle document missing file_url');

      // Idempotency: don't create duplicate receipt rows for the same source document
      const { data: existingReceipt } = await supabase
        .from('receipts')
        .select('id')
        .eq('source_document_table', 'vehicle_documents')
        .eq('source_document_id', params.documentId)
        .maybeSingle();
      if (existingReceipt?.id) {
        return { id: existingReceipt.id };
      }

      const { data: receipt, error: recErr } = await supabase
        .from('receipts')
        .insert({
          // Required columns
          user_id: user.id,
          file_url: fileUrl,

          // Helpful metadata (optional)
          file_name: fileName,
          file_type: fileType,

          // Vehicle scoping
          scope_type: 'vehicle',
          scope_id: params.vehicleId,
          vehicle_id: params.vehicleId,
          source_document_table: 'vehicle_documents',
          source_document_id: params.documentId,

          vendor_name: parsed.vendor_name || null,
          transaction_date: parsed.receipt_date || null,
          receipt_date: parsed.receipt_date || null,
          currency: parsed.currency || 'USD',
          subtotal: parsed.subtotal ?? null,
          tax_amount: parsed.tax ?? null,
          total_amount: parsed.total ?? null,
          tax: parsed.tax ?? null,
          total: parsed.total ?? null,
          payment_method: parsed.payment_method || null,
          card_last4: parsed.card_last4 || null,
          card_holder: parsed.card_holder || null,
          invoice_number: parsed.invoice_number || null,
          purchase_order: parsed.purchase_order || null,
          raw_json: parsed.raw_json || parsed,
          status: 'processed',
          // Align with DB functions (e.g. compute_vehicle_value) which treat 'parsed' as a valid parsed receipt state
          processing_status: 'parsed',
          created_by: user.id
        })
        .select('id')
        .single();

      if (recErr) throw recErr;

      const items = parsed.items || [];
      if (items.length > 0) {
        // Map to enum values in public.parts_category (lowercase)
        const allowedCategories = new Set([
          'audio','brakes','consumables','cooling','electrical','engine','exhaust','exterior','fee','fuel_system','hardware','hvac','interior','labor','lighting','maintenance','paint','safety','shipping','storage','suspension','tax','tools','transmission'
        ]);
        const autoCategory = (desc?: string): string | null => {
          const d = (desc || '').toLowerCase();
          if (/labor|install|installation|service|hour|hrs\b/.test(d)) return 'labor';
          if (/engine|motor|intake|radiator|coolant|filter|spark/.test(d)) return 'engine';
          if (/brake|pad|rotor|caliper|master/.test(d)) return 'brakes';
          if (/suspension|shock|spring|coilover|strut/.test(d)) return 'suspension';
          if (/transmission|clutch|gear|drivetrain/.test(d)) return 'transmission';
          if (/tire|wheel|rim/.test(d)) return 'tools';
          if (/body|panel|fender|hood|bumper|paint|wrap/.test(d)) return 'paint';
          if (/interior|seat|trim|dash|carpet|stereo/.test(d)) return 'interior';
          if (/electrical|wiring|harness|battery|alternator/.test(d)) return 'electrical';
          if (/fuel|gas|tank|pump|injector/.test(d)) return 'fuel_system';
          if (/exhaust|muffler|pipe|header/.test(d)) return 'exhaust';
          if (/cooling|radiator|thermostat|water\\s*pump/.test(d)) return 'cooling';
          if (/hvac|heating|air\\s*conditioning|\\bac\\b|climate/.test(d)) return 'hvac';
          if (/light|bulb|led|halogen/.test(d)) return 'lighting';
          if (/audio|speaker|radio|head\\s*unit/.test(d)) return 'audio';
          if (/safety|airbag|seatbelt|sensor/.test(d)) return 'safety';
          if (/maintenance|oil|fluid/.test(d)) return 'maintenance';
          if (/tax\\b|taxes\\b/.test(d)) return 'tax';
          if (/fee\\b|fees\\b|charge\\b|charges\\b/.test(d)) return 'fee';
          if (/shipping|freight|delivery/.test(d)) return 'shipping';
          if (/storage\\b/.test(d)) return 'storage';
          return null;
        };
        const normalizeCategory = (raw?: string | null, desc?: string): string | null => {
          const r = (raw || '').toLowerCase().trim();
          if (r && allowedCategories.has(r)) return r;
          const inferred = autoCategory(desc);
          if (inferred && allowedCategories.has(inferred)) return inferred;
          return null;
        };

        const rows = items.map((it) => {
          const desc = (it.description || '').trim() || 'Line item';
          const qty = typeof it.quantity === 'number' ? it.quantity : null;
          const unit = typeof it.unit_price === 'number' ? it.unit_price : null;
          const explicitTotal = typeof (it as any).total_price === 'number' ? (it as any).total_price : null;
          const computedTotal = qty !== null && unit !== null ? qty * unit : null;
          const lineTotal = explicitTotal ?? computedTotal ?? 0;
          return {
            receipt_id: receipt.id,
            vehicle_id: params.vehicleId,
            description: desc,
            part_number: it.part_number || null,
            sku: (it as any).vendor_sku || null,
            category: normalizeCategory((it as any).category, desc) || null,
            quantity: qty,
            unit_price: unit,
            line_total: lineTotal,
            extracted_by_ai: true,
            confidence_score: (typeof (parsed as any)?.confidence === 'number' ? (parsed as any).confidence : null)
          };
        });
        const { error: itemErr } = await supabase.from('receipt_items').insert(rows);
        if (itemErr) throw itemErr;
      }

      // Best-effort: copy top-level fields back to vehicle_documents for quick ledger rollups
      try {
        await supabase
          .from('vehicle_documents')
          .update({
            vendor_name: parsed.vendor_name || null,
            amount: typeof parsed.total === 'number' ? parsed.total : null,
            currency: parsed.currency || 'USD',
            updated_at: new Date().toISOString()
          })
          .eq('id', params.documentId);
      } catch {
        // ignore
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

      // Resolve the shop document so we can satisfy receipts NOT NULL column (file_url)
      const { data: shopDoc, error: shopDocErr } = await supabase
        .from('shop_documents')
        .select('file_url, mime_type, title')
        .eq('id', params.documentId)
        .maybeSingle();
      if (shopDocErr) throw shopDocErr;
      const fileUrl = (shopDoc as any)?.file_url ? String((shopDoc as any).file_url) : null;
      const fileType = (shopDoc as any)?.mime_type ? String((shopDoc as any).mime_type) : null;
      const fileName = (shopDoc as any)?.title ? String((shopDoc as any).title) : null;
      if (!fileUrl) throw new Error('Shop document missing file_url');

      const { parsed } = params;
      const { data: receipt, error: recErr } = await supabase
        .from('receipts')
        .insert({
          user_id: user.id,
          file_url: fileUrl,
          file_name: fileName,
          file_type: fileType,
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
        const allowedCategories = new Set([
          'audio','brakes','consumables','cooling','electrical','engine','exhaust','exterior','fee','fuel_system','hardware','hvac','interior','labor','lighting','maintenance','paint','safety','shipping','storage','suspension','tax','tools','transmission'
        ]);
        const normalizeCategory = (raw?: string | null): string | null => {
          const r = (raw || '').toLowerCase().trim();
          return r && allowedCategories.has(r) ? r : null;
        };
        const rows = items.map((it) => {
          const desc = (it.description || '').trim() || 'Line item';
          const qty = typeof it.quantity === 'number' ? it.quantity : null;
          const unit = typeof it.unit_price === 'number' ? it.unit_price : null;
          const explicitTotal = typeof (it as any).total_price === 'number' ? (it as any).total_price : null;
          const computedTotal = qty !== null && unit !== null ? qty * unit : null;
          const lineTotal = explicitTotal ?? computedTotal ?? 0;
          return {
            receipt_id: receipt.id,
            description: desc,
            part_number: it.part_number || null,
            sku: (it as any).vendor_sku || null,
            category: normalizeCategory((it as any).category) || null,
            quantity: qty,
            unit_price: unit,
            line_total: lineTotal,
            extracted_by_ai: true,
            confidence_score: (typeof (parsed as any)?.confidence === 'number' ? (parsed as any).confidence : null)
          };
        });
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
