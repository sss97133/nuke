import { supabase } from '../lib/supabase';
import type { ParsedReceipt } from './receiptExtractionService';

export class ReceiptValidationService {
  static async validate(params: { parsed: ParsedReceipt; ocrText?: string }): Promise<ParsedReceipt> {
    try {
      const { parsed } = params;
      let ocrText = params.ocrText || '';
      if (ocrText.length > 20000) ocrText = ocrText.slice(0, 20000); // cap size
      const { data, error } = await supabase.functions.invoke('receipt-llm-validate', {
        body: { parsed, ocr_text: ocrText, provider: 'anthropic' }
      } as any);
      if (error) throw error;
      let payload: any = data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch {}
      }
      if (!payload || typeof payload !== 'object') return parsed;
      return payload as ParsedReceipt;
    } catch (e) {
      return params.parsed; // fall back to existing parsed values
    }
  }
}

export const receiptValidationService = ReceiptValidationService;
