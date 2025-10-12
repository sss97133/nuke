/**
 * Receipt Service - Handles all receipt storage and inventory management
 */

import { supabase } from '../lib/supabase';
import type { UniversalReceiptResult } from './universalReceiptParser';

export interface SaveReceiptResult {
  success: boolean;
  receiptId?: string;
  error?: string;
}

export class ReceiptService {
  /**
   * Upload receipt file to Supabase Storage (tool-data bucket)
   */
  static async uploadReceiptFile(userId: string, file: File): Promise<string | null> {
    console.log(`📤 Uploading ${file.name} to tool-data bucket (${(file.size / 1024).toFixed(1)}KB)...`);
    
    try {
      // Try proper S3 upload first
      const timestamp = Date.now();
      const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${userId}/receipts/${timestamp}_${cleanFileName}`;
      
      const { data, error } = await supabase.storage
        .from('tool-data')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('❌ S3 upload failed:', error);
        console.warn('⚠️ Falling back to base64 storage...');
        
        // Fallback to base64 if RLS policies aren't configured yet
        return await this.uploadAsBase64(file);
      }

      if (data) {
        // Get public URL
        const { data: urlData } = supabase.storage
          .from('tool-data')
          .getPublicUrl(filePath);
        
        console.log('✅ File uploaded successfully to S3');
        console.log('📍 File path:', filePath);
        console.log('🔗 Public URL:', urlData.publicUrl);
        
        return urlData.publicUrl;
      }
      
      return null;
    } catch (error) {
      console.error('Error uploading file:', error);
      console.warn('⚠️ Falling back to base64 storage...');
      
      // Fallback to base64
      return await this.uploadAsBase64(file);
    }
  }

  /**
   * Fallback method: Convert file to base64 and store as data URL
   * Only used if RLS policies aren't configured
   */
  private static async uploadAsBase64(file: File): Promise<string> {
    console.log('⚠️ Using base64 fallback (database storage)');
    console.log('💡 Configure RLS policies to enable proper S3 uploads');
    
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        console.log('✅ File converted to base64 data URL');
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Save parsed receipt to Supabase database
   */
  static async saveReceiptToSupabase(
    userId: string,
    file: File,
    fileUrl: string,
    parseResult: UniversalReceiptResult
  ): Promise<SaveReceiptResult> {
    try {
      // 1. Insert main receipt record
      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .insert({
          user_id: userId,
          file_url: fileUrl,
          file_name: file.name,
          file_type: file.type,
          processing_status: parseResult.success ? 'completed' : 'failed',
          vendor_name: parseResult.receipt_metadata.vendor_name,
          vendor_address: parseResult.receipt_metadata.vendor_address,
          transaction_date: parseResult.receipt_metadata.transaction_date,
          transaction_number: parseResult.receipt_metadata.transaction_number,
          total_amount: parseResult.receipt_metadata.total_amount,
          subtotal: parseResult.receipt_metadata.subtotal,
          tax_amount: parseResult.receipt_metadata.tax_amount,
          raw_extraction: parseResult.raw_extraction,
          confidence_score: parseResult.confidence_score,
          extraction_errors: parseResult.errors
        })
        .select()
        .single();

      if (receiptError) {
        console.error('Error inserting receipt:', receiptError);
        throw receiptError;
      }

      // Dedupe line items by (transaction_date,total_price) and prefer richer rows
      const pickBest = (items: any[]) => {
        const groups = new Map<string, any[]>();
        const keyOf = (it: any) => `${it.transaction_date || ''}|${Number(it.total_price || 0).toFixed(2)}`;
        for (const it of items) {
          if (!it || !it.total_price) continue;
          const k = keyOf(it);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(it);
        }
        const score = (it: any) => {
          const desc = (it.description || '').toString();
          const pn = (it.part_number || '').toString();
          let s = 0;
          s += Math.min(desc.length, 80); // prefer longer, cap
          if (pn) s += 20;
          if (/(BOX|CHEST|SET|RATCH|WRENCH|SOCKET|IMPACT|KIT)/i.test(desc)) s += 10;
          if (/^AE\d{5,}$/i.test(pn)) s -= 8; // likely admin/ref code, not product
          return s;
        };
        const out: any[] = [];
        if (groups.size === 0) return items; // nothing to dedupe
        for (const arr of groups.values()) {
          let best = arr[0];
          let bestScore = score(best);
          for (let i = 1; i < arr.length; i++) {
            const sc = score(arr[i]);
            if (sc > bestScore) { best = arr[i]; bestScore = sc; }
          }
          out.push(best);
        }
        return out;
      };

      const dedupedItems = pickBest(parseResult.line_items);

      // 2. Insert line items
      if (dedupedItems.length > 0) {
        const lineItemsToInsert = dedupedItems.map(item => ({
          receipt_id: receipt.id,
          user_id: userId,
          part_number: item.part_number,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          total_price: item.total_price,
          discount: item.discount,
          brand: item.brand,
          category: this.categorizeItem(item.description, item.brand),
          serial_number: item.serial_number,
          transaction_date: parseResult.receipt_metadata.transaction_date,
          transaction_number: parseResult.receipt_metadata.transaction_number,
          line_type: item.line_type,
          additional_data: item.additional_data
        }));

        const { error: lineItemsError } = await supabase
          .from('line_items')
          .insert(lineItemsToInsert);

        if (lineItemsError) {
          console.error('Error inserting line items:', lineItemsError);
          throw lineItemsError;
        }
      }

      // 3. Insert payment records
      if (parseResult.payment_records.length > 0) {
        const paymentsToInsert = parseResult.payment_records.map(payment => ({
          receipt_id: receipt.id,
          user_id: userId,
          payment_date: payment.payment_date || parseResult.receipt_metadata.transaction_date,
          payment_type: payment.payment_type,
          amount: payment.amount,
          transaction_number: payment.transaction_number || parseResult.receipt_metadata.transaction_number
        }));

        const { error: paymentsError } = await supabase
          .from('payment_records')
          .insert(paymentsToInsert);

        if (paymentsError) {
          console.error('Error inserting payment records:', paymentsError);
          // Non-critical error, continue
        }
      }

      // 4. Update or create user_tools inventory (use deduped items)
      await this.updateUserInventory(
        userId, 
        dedupedItems, 
        receipt.id,
        parseResult.receipt_metadata.transaction_date
      );

      return { success: true, receiptId: receipt.id };

    } catch (error) {
      console.error('Error saving to Supabase:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to save receipt' 
      };
    }
  }

  /**
   * Update user's tool inventory based on receipt line items
   */
  private static async updateUserInventory(
    userId: string,
    lineItems: any[],
    receiptId: string,
    transactionDate?: string
  ) {
    // Only process sale items with part numbers for inventory
    const toolItems = lineItems.filter(item => 
      item.line_type === 'sale' && (item.part_number || item.description)
    );

    for (const item of toolItems) {
      const identifier = item.part_number || item.description;
      
      // Check if tool already exists in inventory
      const { data: existing } = await supabase
        .from('user_tools')
        .select('*')
        .eq('user_id', userId)
        .or(`part_number.eq.${identifier},description.eq.${item.description}`)
        .maybeSingle();

      if (existing) {
        // Update existing tool
        await supabase
          .from('user_tools')
          .update({
            total_quantity: (existing.total_quantity || 0) + (item.quantity || 1),
            last_purchase_date: transactionDate,
            total_spent: (existing.total_spent || 0) + (item.total_price || 0),
            receipt_ids: [...(existing.receipt_ids || []), receiptId],
            serial_numbers: item.serial_number 
              ? [...(existing.serial_numbers || []), item.serial_number]
              : existing.serial_numbers,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new tool in inventory
        await supabase
          .from('user_tools')
          .insert({
            user_id: userId,
            part_number: item.part_number,
            description: item.description,
            brand: item.brand || this.detectBrand(item.description),
            category: this.categorizeItem(item.description, item.brand),
            total_quantity: item.quantity || 1,
            first_purchase_date: transactionDate,
            last_purchase_date: transactionDate,
            total_spent: item.total_price || 0,
            receipt_ids: [receiptId],
            serial_numbers: item.serial_number ? [item.serial_number] : [],
            condition: 'new',
            metadata: {
              source: 'receipt_import',
              import_date: new Date().toISOString()
            }
          });
      }
    }
  }

  /**
   * Categorize item based on description
   */
  private static categorizeItem(description: string, brand?: string | null): string {
    const desc = description.toLowerCase();
    
    // Tool categories
    if (desc.includes('ratchet') || desc.includes('socket')) return 'Sockets & Ratchets';
    if (desc.includes('wrench') || desc.includes('spanner')) return 'Wrenches';
    if (desc.includes('plier')) return 'Pliers';
    if (desc.includes('screwdriver') || desc.includes('bit')) return 'Screwdrivers';
    if (desc.includes('hammer') || desc.includes('mallet')) return 'Hammers';
    if (desc.includes('torque')) return 'Torque Tools';
    if (desc.includes('air') || desc.includes('pneumatic')) return 'Air Tools';
    if (desc.includes('electric') || desc.includes('cordless') || desc.includes('battery')) return 'Power Tools';
    if (desc.includes('diagnostic') || desc.includes('scanner')) return 'Diagnostic Tools';
    if (desc.includes('jack') || desc.includes('lift')) return 'Lifting Equipment';
    if (desc.includes('gauge') || desc.includes('meter')) return 'Measuring Tools';
    if (desc.includes('box') || desc.includes('chest') || desc.includes('cabinet')) return 'Storage';
    if (desc.includes('light') || desc.includes('lamp')) return 'Lighting';
    if (desc.includes('safety') || desc.includes('glove') || desc.includes('glass')) return 'Safety Equipment';
    
    // Auto parts categories
    if (desc.includes('brake')) return 'Brake Parts';
    if (desc.includes('filter')) return 'Filters';
    if (desc.includes('oil') || desc.includes('fluid')) return 'Fluids & Chemicals';
    if (desc.includes('belt') || desc.includes('hose')) return 'Belts & Hoses';
    if (desc.includes('battery')) return 'Batteries';
    
    // Check brand for category hints
    if (brand) {
      const brandLower = brand.toLowerCase();
      if (brandLower.includes('snap') || brandLower.includes('mac') || brandLower.includes('matco')) {
        return 'Professional Tools';
      }
    }
    
    return 'Miscellaneous';
  }

  /**
   * Detect brand from description
   */
  private static detectBrand(description: string): string | null {
    const desc = description.toLowerCase();
    
    // Common tool brands
    if (desc.includes('snap-on') || desc.includes('snapon')) return 'Snap-on';
    if (desc.includes('mac tools') || desc.includes('mac ')) return 'Mac Tools';
    if (desc.includes('matco')) return 'Matco';
    if (desc.includes('cornwell')) return 'Cornwell';
    if (desc.includes('craftsman')) return 'Craftsman';
    if (desc.includes('dewalt')) return 'DeWalt';
    if (desc.includes('milwaukee')) return 'Milwaukee';
    if (desc.includes('makita')) return 'Makita';
    if (desc.includes('rigid') || desc.includes('ridgid')) return 'Ridgid';
    if (desc.includes('harbor freight')) return 'Harbor Freight';
    if (desc.includes('husky')) return 'Husky';
    if (desc.includes('kobalt')) return 'Kobalt';
    if (desc.includes('tekton')) return 'Tekton';
    if (desc.includes('gearwrench')) return 'GearWrench';
    
    return null;
  }

  /**
   * Get user's receipts
   */
  static async getUserReceipts(userId: string) {
    const { data, error } = await supabase
      .from('receipts')
      .select('*, line_items(*), payment_records(*)')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false });

    if (error) {
      console.error('Error fetching receipts:', error);
      return [];
    }

    return data;
  }

  /**
   * Get user's tool inventory
   */
  static async getUserTools(userId: string) {
    const { data, error } = await supabase
      .from('user_tools')
      .select('*')
      .eq('user_id', userId)
      .order('last_purchase_date', { ascending: false });

    if (error) {
      console.error('Error fetching tools:', error);
      return [];
    }

    return data;
  }

  /**
   * Get receipt statistics
   */
  static async getReceiptStats(userId: string) {
    const { data: receipts } = await supabase
      .from('receipts')
      .select('total_amount, transaction_date')
      .eq('user_id', userId);

    const { data: tools } = await supabase
      .from('user_tools')
      .select('total_spent, total_quantity')
      .eq('user_id', userId);

    const totalSpent = receipts?.reduce((sum, r) => sum + (r.total_amount || 0), 0) || 0;
    const receiptCount = receipts?.length || 0;
    const toolCount = tools?.length || 0;
    const totalQuantity = tools?.reduce((sum, t) => sum + (t.total_quantity || 0), 0) || 0;

    return {
      totalSpent,
      receiptCount,
      uniqueTools: toolCount,
      totalItems: totalQuantity,
      averageReceiptAmount: receiptCount > 0 ? totalSpent / receiptCount : 0
    };
  }
}

// Export convenience functions
export async function saveReceipt(
  userId: string,
  file: File,
  fileUrl: string,
  parseResult: UniversalReceiptResult
): Promise<SaveReceiptResult> {
  return ReceiptService.saveReceiptToSupabase(userId, file, fileUrl, parseResult);
}

export async function getUserReceipts(userId: string) {
  return ReceiptService.getUserReceipts(userId);
}

export async function getUserTools(userId: string) {
  return ReceiptService.getUserTools(userId);
}
