/**
 * Universal Receipt Parser - Handles ANY receipt format
 * Works with Snap-on, Mac Tools, Harbor Freight, Home Depot, handwritten, etc.
 */

export interface UniversalReceiptResult {
  success: boolean;
  receipt_metadata: {
    vendor_name?: string;
    vendor_address?: string;
    transaction_date?: string;
    transaction_number?: string;
    total_amount?: number;
    subtotal?: number;
    tax_amount?: number;
    payment_method?: string;
  };
  line_items: Array<{
    part_number?: string;
    description: string;
    quantity: number;
    unit_price?: number;
    total_price?: number;
    discount?: number;
    brand?: string;
    serial_number?: string;
    line_type: 'sale' | 'warranty' | 'return' | 'payment' | 'unknown';
    additional_data?: Record<string, any>;
  }>;
  payment_records: Array<{
    payment_date?: string;
    payment_type?: string;
    amount: number;
    transaction_number?: string;
  }>;
  raw_extraction: any;
  confidence_score: number;
  errors: string[];
}

export class UniversalReceiptParser {
  private static API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  static async parseReceipt(file: File): Promise<UniversalReceiptResult> {
    console.log('📤 Sending receipt to backend proxy for parsing...');
    
    // Use fallback parser for text files if available
    if (file.type === 'text/plain') {
      const text = await file.text();
      const { FallbackReceiptParser } = await import('./fallbackReceiptParser');
      return FallbackReceiptParser.parseReceiptText(text);
    }

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      const response = await this.fetchWithRetry(`${this.API_BASE_URL}/receipts/parse`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('Backend API error:', errorText);
        // Fallback locally when backend wraps a Claude 503 or returns 500/503
        if (
          response.status === 500 ||
          response.status === 503 ||
          (errorText && /Claude API error:\s*503/.test(errorText))
        ) {
          console.warn('Backend failed (Claude 503/500). Falling back to client-side parsing...');
          return await this.clientSideFallback(file);
        }
        return this.createErrorResult(`Server error: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Receipt parsed successfully:', result);
      
      return result;

    } catch (error) {
      console.error('Network/Proxy error parsing receipt:', error);
      // Attempt client-side fallback on network/proxy errors
      try {
        return await this.clientSideFallback(file);
      } catch (fallbackErr) {
        console.error('Client-side fallback failed:', fallbackErr);
        return this.createErrorResult(
          error instanceof Error ? error.message : 'Unknown error'
        );
      }
    }
  }

  static async parseReceiptText(text: string): Promise<UniversalReceiptResult> {
    // Use fallback parser for text
    const { FallbackReceiptParser } = await import('./fallbackReceiptParser');
    return FallbackReceiptParser.parseReceiptText(text);
  }

  private static sanitizeMetadata(meta: any) {
    return {
      vendor_name: meta.vendor_name || undefined,
      vendor_address: meta.vendor_address || undefined,
      transaction_date: meta.transaction_date || undefined,
      transaction_number: meta.transaction_number || undefined,
      total_amount: meta.total_amount ? Number(meta.total_amount) : undefined,
      subtotal: meta.subtotal ? Number(meta.subtotal) : undefined,
      tax_amount: meta.tax_amount ? Number(meta.tax_amount) : undefined,
      payment_method: meta.payment_method || undefined
    };
  }

  private static sanitizeLineItem(item: any) {
    const validLineTypes = ['sale', 'warranty', 'return', 'payment', 'unknown'];
    const lineType = validLineTypes.includes(item.line_type) ? item.line_type : 'unknown';
    
    return {
      part_number: item.part_number || null,
      description: String(item.description || 'Unknown Item'),
      quantity: Number(item.quantity) || 1,
      unit_price: item.unit_price ? Number(item.unit_price) : null,
      total_price: item.total_price ? Number(item.total_price) : null,
      discount: item.discount ? Number(item.discount) : null,
      brand: item.brand || null,
      serial_number: item.serial_number || null,
      line_type: lineType,
      additional_data: item.additional_data || null
    };
  }

  private static sanitizePayment(payment: any) {
    return {
      payment_date: payment.payment_date || null,
      payment_type: payment.payment_type || null,
      amount: Number(payment.amount) || 0,
      transaction_number: payment.transaction_number || null
    };
  }

  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        // Remove data URL prefix to get just base64
        resolve(base64.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private static async fetchWithRetry(url: string, options: RequestInit, retries = 3, backoff = 300): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);

        // Check for retryable conditions (backend wrapping a 503 from Claude)
        if (response.status === 500) {
          const clonedResponse = response.clone();
          const errorBody = await clonedResponse.json().catch(() => ({}));
          
          if (errorBody.error && errorBody.error.includes('Claude API error: 503')) {
            console.warn(`Attempt ${i + 1} failed with wrapped 503. Retrying in ${backoff}ms...`);
            // Fall through to retry logic
          } else {
            return response; // Not the error we're looking for, return immediately
          }
        } else if (response.status === 503) {
            console.warn(`Attempt ${i + 1} failed with 503. Retrying in ${backoff}ms...`);
            // Fall through to retry logic
        } else {
          return response; // Not a retryable error
        }

      } catch (error) {
        if (i === retries - 1) throw error;
        console.warn(`Attempt ${i + 1} failed with network error. Retrying in ${backoff}ms...`);
      }

      await new Promise(res => setTimeout(res, backoff));
      backoff *= 2; // Exponential backoff
    }
    throw new Error(`Request failed after ${retries} attempts due to persistent service unavailability.`);
  }

  // Client-side fallback path when backend proxy/Claude is unavailable
  private static async clientSideFallback(file: File): Promise<UniversalReceiptResult> {
    const type = file.type || '';

    // 1) Text files: already handled above, but keep for safety
    if (type === 'text/plain') {
      const text = await file.text();
      const { FallbackReceiptParser } = await import('./fallbackReceiptParser');
      return FallbackReceiptParser.parseReceiptText(text);
    }

    // 2) PDFs: try local pdf.js + Snap-on first (no CORS), then generic regex fallback, then Claude document as LAST resort
    if (type === 'application/pdf') {
      try {
        const pdfText = await this.extractPdfText(file);

        // Try Snap-on deterministic parser first (token-free, faster)
        try {
          const { SnapOnParser } = await import('./snapOnParser');
          const parsedTools = SnapOnParser.parse(pdfText || '');
          if (parsedTools && parsedTools.length > 0) {
            const line_items = parsedTools.map(t => ({
              part_number: t.part_number || undefined,
              description: (t as any).name || (t as any).description || 'Tool',
              quantity: (t as any).quantity ?? 1,
              unit_price: (t as any).purchase_price ?? undefined,
              total_price: (t as any).purchase_price ?? undefined,
              discount: (t as any).metadata?.discount ?? undefined,
              brand: (t as any).brand_name || 'Snap-on',
              serial_number: (t as any).serial_number || undefined,
              line_type: 'sale' as const,
              additional_data: (t as any).metadata || undefined
            }));

            const total = line_items.reduce((s, li) => s + (li.total_price || 0), 0);
            return {
              success: line_items.length > 0,
              line_items,
              payment_records: [],
              receipt_metadata: {
                vendor_name: 'Snap-on',
                transaction_date: (parsedTools[0] as any)?.purchase_date || undefined,
                total_amount: total,
                transaction_number: undefined
              },
              raw_extraction: { method: 'client_fallback_pdfjs_snapon', text_len: (pdfText || '').length },
              confidence_score: 0.6,
              errors: []
            };
          }
        } catch (e) {
          console.warn('SnapOnParser not applicable or failed:', e);
        }

        // Generic fallback parse on extracted text
        const { FallbackReceiptParser } = await import('./fallbackReceiptParser');
        return FallbackReceiptParser.parseReceiptText(pdfText || '');
      } catch (e) {
        console.warn('PDF text extraction failed. Trying Claude document (may be blocked by CORS in browser)...', e);
        // Last resort: try Claude direct document parsing (may be blocked by CORS)
        try {
          const { ClaudeReceiptParser } = await import('./claudeReceiptParser');
          const docResult = await ClaudeReceiptParser.parseReceiptDocument(file);
          if (docResult?.success && (docResult.tools?.length || 0) > 0) {
            return this.wrapClaudeImageResult(docResult);
          }
        } catch (ce) {
          console.warn('Claude document parse failed:', ce);
        }
        return this.createErrorResult('Failed to parse PDF');
      }
    }

    // 3) Images: call Claude directly from client (Haiku) if available
    if (type.startsWith('image/')) {
      try {
        const { ClaudeReceiptParser } = await import('./claudeReceiptParser');
        const result = await ClaudeReceiptParser.parseReceiptImage(file);
        return this.wrapClaudeImageResult(result);
      } catch (e) {
        console.warn('Claude image fallback failed:', e);
        return this.createErrorResult('Failed to parse image receipt locally');
      }
    }

    // Unknown type: bail to error
    return this.createErrorResult(`Unsupported file type for client fallback: ${type}`);
  }

  // Public wrapper to trigger local parsing from UI
  static async parseFallback(file: File): Promise<UniversalReceiptResult> {
    return this.clientSideFallback(file);
  }

  // Extract text from PDF using pdfjs-dist
  private static async extractPdfText(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const pdfjsLib: any = await import('pdfjs-dist');
    try {
      const workerUrlMod: any = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlMod.default || workerUrlMod;
    } catch (_) {
      // If setting worker fails, pdfjs may still work depending on env
    }

    const loadingTask = (pdfjsLib as any).getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it: any) => it.str).join(' ');
      text += pageText + '\n';
    }
    return text;
  }

  // Wrap Claude image/text results to UniversalReceiptResult
  private static wrapClaudeImageResult(result: any): UniversalReceiptResult {
    if (!result?.success) {
      return this.createErrorResult((result?.errors && result.errors[0]) || 'Claude image parsing failed');
    }
    const line_items = (result.tools || []).map((t: any) => ({
      part_number: t.part_number || undefined,
      description: t.description || 'Tool',
      quantity: t.quantity || 1,
      unit_price: t.unit_price || undefined,
      total_price: t.total_price || t.unit_price || undefined,
      discount: t.discount || undefined,
      brand: t.brand || undefined,
      serial_number: t.serial_number || undefined,
      line_type: 'sale' as const,
      additional_data: undefined
    }));
    return {
      success: true,
      line_items,
      payment_records: [],
      receipt_metadata: {
        vendor_name: result.summary?.supplier || undefined,
        transaction_date: result.summary?.date || undefined,
        transaction_number: result.summary?.transaction_number || undefined,
        total_amount: result.summary?.total_amount || undefined
      },
      raw_extraction: result,
      confidence_score: 0.8,
      errors: []
    };
  }

  private static wrapClaudeTextResult(result: any): UniversalReceiptResult {
    return this.wrapClaudeImageResult(result);
  }

  private static createErrorResult(error: string): UniversalReceiptResult {
    return {
      success: false,
      receipt_metadata: {},
      line_items: [],
      payment_records: [],
      raw_extraction: null,
      confidence_score: 0,
      errors: [error]
    };
  }
}

// Export convenience functions
export async function parseAnyReceipt(file: File): Promise<UniversalReceiptResult> {
  return UniversalReceiptParser.parseReceipt(file);
}

export async function parseReceiptText(text: string): Promise<UniversalReceiptResult> {
  // Always use fallback parser for text
  const { FallbackReceiptParser } = await import('./fallbackReceiptParser');
  return FallbackReceiptParser.parseReceiptText(text);
}

// Force local parsing (bypass backend). Useful when proxy/Claude is down.
export async function parseAnyReceiptLocal(file: File): Promise<UniversalReceiptResult> {
  return UniversalReceiptParser.parseFallback(file);
}
