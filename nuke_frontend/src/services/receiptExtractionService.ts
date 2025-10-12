import { supabase } from '../lib/supabase';

export interface ParsedReceiptItem {
  line_number?: number;
  description?: string;
  part_number?: string;
  vendor_sku?: string;
  category?: string;
  quantity?: number;
  unit_price?: number;
  total_price?: number;
}

export interface ParsedReceipt {
  vendor_name?: string;
  receipt_date?: string; // ISO date
  currency?: string;
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  payment_method?: string;
  card_last4?: string;
  card_holder?: string;
  invoice_number?: string;
  purchase_order?: string;
  items?: ParsedReceiptItem[];
  raw_json?: any;
}

export interface ExtractInput {
  bucket?: string;
  path?: string;
  mimeType?: string;
  url?: string;
}

export class ReceiptExtractionService {
  static async extract({ bucket, path, mimeType, url }: ExtractInput): Promise<ParsedReceipt> {
    const { data, error } = await supabase.functions.invoke('receipt-extract', {
      body: { bucket, path, mimeType, url }
    } as any);
    if (error) throw error;
    let payload: any = data;
    // If the function returned a JSON string, parse it
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch {}
    }
    if (!payload) throw new Error('Empty extraction response');
    // Handle AWS API Gateway Lambda proxy envelope
    if (typeof payload === 'object' && 'statusCode' in payload && 'body' in payload) {
      try {
        const body = (payload as any).body;
        payload = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        throw new Error('Empty extraction response');
      }
    }
    if (!payload || typeof payload !== 'object') throw new Error('Empty extraction response');
    if ((payload as any).error) throw new Error((payload as any).error);
    return payload as ParsedReceipt;
  }
}

export const receiptExtractionService = ReceiptExtractionService;
