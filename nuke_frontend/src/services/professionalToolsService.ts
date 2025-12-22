/**
 * Professional Tools Service
 * Handles PDF parsing, tool data extraction, and database operations
 * for the professional tools inventory system
 */

import { supabase } from '../lib/supabase';
import { SnapOnParser } from './snapOnParser';
import { ClaudeReceiptParser, type ClaudeReceiptParseResult } from './claudeReceiptParser';
import type { ParsedTool, ToolImportResult } from './types/toolTypes';
// Re-export types for backward compatibility
export type { ParsedTool, ToolImportResult } from './types/toolTypes';
// For now, we'll handle PDF parsing server-side or use text extraction
// PDF.js has issues with worker loading in Vite

export class ProfessionalToolsService {
  /**
   * Extract text from PDF file - DISABLED due to worker issues
   * Users should paste text manually or we'll use OpenAI Vision
   */
  static async extractTextFromPDF(file: File): Promise<string> {
    // PDF.js has worker issues in browser, skip text extraction
    throw new Error('PDF text extraction not available. Please paste the receipt text manually or upload as an image.');
  }
  
  static parseSnapOnReceipt(text: string): ParsedTool[] {
    // Use the new parser that handles PDF extraction issues better
    return SnapOnParser.parse(text);
  }

  /**
   * Parse Mac Tools receipt format
   */
  static parseMacToolsReceipt(text: string): ParsedTool[] {
    const tools: ParsedTool[] = [];
    // Mac Tools has different format - implement when we have samples
    // This is a placeholder for future expansion
    return tools;
  }

  /**
   * Parse Matco Tools receipt format
   */
  static parseMatcoReceipt(text: string): ParsedTool[] {
    const tools: ParsedTool[] = [];
    // Matco has different format - implement when we have samples
    return tools;
  }

  /**
   * Generic receipt parser using AI/ML
   * This could integrate with OpenAI Vision API for complex receipts
   */
  static async parseGenericReceipt(text: string, imageUrl?: string): Promise<ParsedTool[]> {
    const tools: ParsedTool[] = [];
    
    // Use OpenAI to extract structured data if available
    if (process.env.VITE_OPENAI_API_KEY && imageUrl) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.VITE_OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4-vision-preview',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Extract all tools from this receipt. For each tool, provide:
                    - name (product description)
                    - part_number (product part number)
                    - serial_number (if visible)
                    - purchase_price
                    - purchase_date
                    - supplier (brand/store name)
                    Return as JSON array.`
                },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl }
                }
              ]
            }],
            max_tokens: 4096
          })
        });
        
        const data = await response.json();
        const extracted = JSON.parse(data.choices[0].message.content);
        return extracted;
      } catch (error) {
        console.error('AI extraction failed:', error);
      }
    }
    
    // Fallback to pattern matching
    const lines = text.split('\n');
    const pricePattern = /\$?([\d,]+\.?\d{0,2})/g;
    const datePattern = /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/;
    
    for (const line of lines) {
      const prices = line.match(pricePattern);
      const dates = line.match(datePattern);
      
      if (prices && prices.length > 0) {
        tools.push({
          name: line.replace(pricePattern, '').trim(),
          purchase_price: parseFloat(prices[0].replace(/[$,]/g, '')),
          purchase_date: dates?.[0],
          metadata: { raw_line: line }
        });
      }
    }
    
    return tools;
  }

  /**
   * Auto-detect receipt format and parse accordingly
   */
  static async parseReceipt(text: string, file?: File): Promise<ToolImportResult> {
    const errors: string[] = [];
    let tools: ParsedTool[] = [];
    
    try {
      let claudeResult: ClaudeReceiptParseResult | null = null;
      
      // If we have an image file, use Claude Vision
      if (file && file.type.startsWith('image/')) {
        console.log('Using Claude Vision API for image receipt parsing...');
        claudeResult = await ClaudeReceiptParser.parseReceiptImage(file);
      } else if (text) {
        // Otherwise, use text-based parsing
        console.log('Using Claude AI for text receipt parsing...');
        claudeResult = await ClaudeReceiptParser.parseReceipt(text);
      }
      
      if (claudeResult && claudeResult.success && claudeResult.tools.length > 0) {
        console.log(`Claude AI extracted ${claudeResult.tools.length} tools`);
        
        // Convert Claude's format to our format
        tools = claudeResult.tools.map(item => ({
          name: item.description,
          part_number: item.part_number,
          serial_number: item.serial_number || undefined,
          brand_name: item.brand || claudeResult.summary.supplier,
          purchase_date: item.transaction_date,
          purchase_price: item.total_price || item.unit_price,
          quantity: item.quantity || 1,
          category: this.categorizeProduct(item.description),
          transaction_number: item.transaction_number,
          discount_amount: item.discount,
          metadata: {
            source: 'claude-ai',
            supplier: claudeResult.summary.supplier,
            transaction_date: claudeResult.summary.date,
            transaction_total: claudeResult.summary.total_amount
          }
        }));
        
        // Log summary for debugging
        console.log('Receipt Summary:', {
          supplier: claudeResult.summary.supplier,
          date: claudeResult.summary.date,
          total: claudeResult.summary.total_amount,
          items: claudeResult.summary.total_items
        });
      }
      
      // If Claude didn't find tools, try legacy methods
      if (tools.length === 0) {
        console.log('Claude AI did not find tools, trying legacy parsers...');
        
        // If we have a PDF file, try text extraction
        if (file && file.type === 'application/pdf') {
          console.log('Attempting PDF text extraction...');
          try {
            const extractedText = await this.extractTextFromPDF(file);
            if (extractedText) {
              text = extractedText;
              // Try Claude again with cleaned PDF text
              const pdfResult = await ClaudeReceiptParser.parsePDFReceipt(text);
              if (pdfResult.success && pdfResult.tools.length > 0) {
                tools = pdfResult.tools.map(item => ({
                  name: item.description,
                  part_number: item.part_number,
                  serial_number: item.serial_number || undefined,
                  brand_name: item.brand || pdfResult.summary.supplier,
                  purchase_date: item.transaction_date,
                  purchase_price: item.total_price || item.unit_price,
                  quantity: item.quantity || 1,
                  category: this.categorizeProduct(item.description),
                  transaction_number: item.transaction_number,
                  discount_amount: item.discount,
                  metadata: {
                    source: 'claude-ai-pdf',
                    supplier: pdfResult.summary.supplier
                  }
                }));
              }
            }
          } catch (e) {
            console.log('PDF text extraction failed:', e);
          }
        }
        
        // If still no tools, fall back to pattern-based parsing
        if (tools.length === 0) {
          const textLower = text.toLowerCase();
          
          if (textLower.includes('snap-on') || textLower.includes('snapon')) {
            console.log('Using Snap-on specific parser...');
            tools = this.parseSnapOnReceipt(text);
          } else if (textLower.includes('mac tools')) {
            console.log('Using Mac Tools specific parser...');
            tools = this.parseMacToolsReceipt(text);
          } else if (textLower.includes('matco')) {
            console.log('Using Matco specific parser...');
            tools = this.parseMatcoReceipt(text);
          } else {
            // Last resort: try generic parsing with Claude fallback
            console.log('Attempting generic receipt parsing...');
            const fallbackResult = await ClaudeReceiptParser.parseReceipt(text);
            if (fallbackResult.success) {
              tools = fallbackResult.tools.map(item => ({
                name: item.description,
                part_number: item.part_number,
                serial_number: item.serial_number || undefined,
                brand_name: item.brand || 'Unknown',
                purchase_date: item.transaction_date,
                purchase_price: item.total_price || item.unit_price,
                quantity: item.quantity || 1,
                category: this.categorizeProduct(item.description),
                transaction_number: item.transaction_number,
                discount_amount: item.discount,
                metadata: {
                  source: 'claude-ai-fallback'
                }
              }));
            }
          }
        }
      }
      
      // Validate parsed tools
      if (tools.length > 0) {
        const validation = ClaudeReceiptParser.validateTools(
          tools.map(t => ({
            part_number: t.part_number || '',
            description: t.name,
            quantity: t.quantity || 1,
            unit_price: t.purchase_price || 0,
            total_price: (t.purchase_price || 0) * (t.quantity || 1),
            brand: t.brand_name
          }))
        );
        
        if (validation.invalid.length > 0) {
          errors.push(...validation.errors);
        }
        
        console.log(`Validation: ${validation.valid.length} valid, ${validation.invalid.length} invalid tools`);
      }
      
      if (tools.length === 0) {
        errors.push('No valid tools found in the receipt. Please check the format.');
        if (claudeResult && claudeResult.errors && claudeResult.errors.length > 0) {
          errors.push(...claudeResult.errors);
        }
      }
      
    } catch (error: any) {
      console.error('Receipt parsing error:', error);
      errors.push(error.message || 'Failed to parse receipt');
    }
    
    return {
      success: tools.length > 0,
      toolsImported: tools.length,
      errors,
      tools
    };
  }
  
  static categorizeProduct(desc: string): string {
    const d = desc.toUpperCase();
    if (d.includes('WRENCH') || d.includes('RATCHET')) return 'Hand Tools';
    if (d.includes('IMPACT') || d.includes('DRILL')) return 'Power Tools';
    if (d.includes('SOCKET') || d.includes('SOEX')) return 'Sockets';
    if (d.includes('PLIER')) return 'Pliers';
    if (d.includes('BATTERY')) return 'Batteries';
    if (d.includes('METER') || d.includes('GAUGE')) return 'Measuring';
    return 'Tools';
  }

  /**
   * Track receipt document upload in database
   */
  static async trackReceiptUpload(
    userId: string,
    file: File,
    supplierName?: string,
    receiptDate?: string,
    totalAmount?: number
  ): Promise<string | null> {
    try {
      // Calculate file hash
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      // Check if this receipt was already uploaded
      const { data: existing } = await supabase
        .from('tool_receipt_documents')
        .select('id')
        .eq('file_hash', fileHash)
        .eq('user_id', userId)
        .single();
      
      if (existing) {
        console.log('Receipt already uploaded:', existing.id);
        return existing.id;
      }
      
      // Upload file to storage
      const storagePath = `${userId}/receipts/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('vehicle-data')
        .upload(storagePath, file);
      
      if (uploadError) {
        console.error('Storage upload failed:', uploadError);
        throw uploadError;
      }
      
      // Create database record
      const { data: receipt, error: dbError } = await supabase
        .from('tool_receipt_documents')
        .insert({
          user_id: userId,
          original_filename: file.name,
          file_size: file.size,
          mime_type: file.type,
          file_hash: fileHash,
          storage_path: storagePath,
          supplier_name: supplierName,
          receipt_date: receiptDate,
          total_amount: totalAmount,
          processing_status: 'processing'
        })
        .select('id')
        .single();
      
      if (dbError) {
        console.error('Database insert failed:', dbError);
        throw dbError;
      }
      
      console.log('Receipt tracked:', receipt.id);
      return receipt.id;
    } catch (error) {
      console.error('Failed to track receipt upload:', error);
      return null;
    }
  }

  /**
   * Update receipt processing status
   */
  static async updateReceiptStatus(
    receiptId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    toolsExtracted: number = 0,
    toolsSaved: number = 0,
    errors: string[] = []
  ): Promise<void> {
    try {
      const updateData: any = {
        processing_status: status,
        tools_extracted: toolsExtracted,
        tools_saved: toolsSaved
      };
      
      if (status === 'completed' || status === 'failed') {
        updateData.processed_at = new Date().toISOString();
      }
      
      if (errors.length > 0) {
        updateData.processing_errors = errors;
      }
      
      const { error } = await supabase
        .from('tool_receipt_documents')
        .update(updateData)
        .eq('id', receiptId);
      
      if (error) {
        console.error('Failed to update receipt status:', error);
      }
    } catch (error) {
      console.error('Error updating receipt status:', error);
    }
  }

  /**
   * Save parsed tools to database
   */
  static async saveToolsToDatabase(
    userId: string,
    tools: ParsedTool[],
    receiptDocumentId?: string
  ): Promise<void> {
    const results = [];
    
    // Check for truly duplicate entries (same part number AND purchase date)
    const existingTools = new Set<string>();
    if (tools.length > 0 && receiptDocumentId) {
      // Only check for tools from the same receipt to avoid false duplicates
      const { data: existing } = await supabase
        .from('user_tools')
        .select('part_number, purchase_date')
        .eq('user_id', userId)
        .eq('receipt_document_id', receiptDocumentId);
      
      if (existing) {
        existing.forEach(t => {
          const key = `${t.part_number}_${t.purchase_date}`;
          existingTools.add(key);
        });
        if (existingTools.size > 0) {
          console.log(`Found ${existingTools.size} tools from this receipt already imported`);
        }
      }
    }
    
    for (const tool of tools) {
      try {
        // Skip only if same tool from same receipt (part + date combo)
        const toolKey = `${tool.part_number}_${tool.purchase_date}`;
        if (existingTools.has(toolKey)) {
          console.log(`Skipping duplicate from same receipt: ${tool.part_number} on ${tool.purchase_date}`);
          continue;
        }
        
        // Get or create brand
        let brandId = null;
        if (tool.brand_name) {
          const { data: existingBrand } = await supabase
            .from('tool_brands')
            .select('id')
            .eq('name', tool.brand_name)
            .single();
          
          if (existingBrand) {
            brandId = existingBrand.id;
          } else {
            const { data: newBrand } = await supabase
              .from('tool_brands')
              .insert({ name: tool.brand_name })
              .select('id')
              .single();
            
            brandId = newBrand?.id;
          }
        }
        
        // Find or create category
        let categoryId: string | null = null;
        if (tool.category) {
          const { data: existingCategory } = await supabase
            .from('tool_categories')
            .select('id')
            .eq('name', tool.category)
            .single();
          
          if (existingCategory) {
            categoryId = existingCategory.id;
          } else {
            // Create the category if it doesn't exist
            const { data: newCategory } = await supabase
              .from('tool_categories')
              .insert({ name: tool.category })
              .select('id')
              .single();
            categoryId = newCategory?.id || null;
          }
        }
        
        // Insert tool into user_tools - matching actual table schema
        const toolData = {
          user_id: userId,
          name: tool.name || tool.description || 'Unknown Tool', // name is required
          description: tool.description,
          brand_name: tool.brand_name,
          part_number: tool.part_number,
          serial_number: tool.serial_number,
          category_id: categoryId,
          purchase_date: tool.purchase_date,
          purchase_price: tool.purchase_price,
          purchase_location: tool.metadata?.purchase_location,
          condition: tool.condition || 'new',
          receipt_document_id: receiptDocumentId, // Link to receipt document
          // Store additional flexible data in metadata
          metadata: {
            ...tool.metadata,
            transaction_number: tool.transaction_number,
            original_description: tool.description
          }
        };
        
        const { data, error } = await supabase
          .from('user_tools')
          .insert(toolData)
          .select();
        
        if (error) {
          console.error('Error saving tool:', error);
          console.error('Tool data that failed:', toolData);
        } else {
          console.log('Successfully saved tool:', data);
          results.push(data);
        }
      } catch (error) {
        console.error('Error processing tool:', error);
      }
    }
    
    // Update user's tool skills based on new tools
    await this.updateUserToolSkills(userId);
  }

  /**
   * Update user's skills based on their tools
   */
  static async updateUserToolSkills(userId: string): Promise<void> {
    try {
      // Get tool categories and counts
      const { data: tools } = await supabase
        .from('user_tools')
        .select('category_id, tool_categories(name)')
        .eq('user_id', userId);
      
      if (!tools || tools.length === 0) return;
      
      // Group by category
      const categoryStats = new Map<string, number>();
      for (const tool of tools) {
        // Get category name from the joined data
        const categoryName = (tool as any).tool_categories?.name;
        if (categoryName) {
          categoryStats.set(categoryName, (categoryStats.get(categoryName) || 0) + 1);
        } else if (!tool.category_id) {
          // Count tools without category as "Uncategorized"
          categoryStats.set('Uncategorized', (categoryStats.get('Uncategorized') || 0) + 1);
        }
      }
      
      // Note: user_tool_skills table doesn't exist in the current schema
      // We'll just log the stats for now
      console.log('User tool skills summary:', Object.fromEntries(categoryStats));
      
      // If we need to track skills, we could store them in the profiles metadata
      // or create a proper skills table later
    } catch (error) {
      console.error('Error updating skills:', error);
    }
  }

  /**
   * Categorize tool based on description
   */
  static categorizeByDescription(description: string): string {
    const desc = description.toLowerCase();
    
    // Check against our predefined categories
    if (desc.match(/wrench|ratchet|socket|torque/i)) return 'Hand Tools';
    if (desc.match(/impact|drill|grinder|saw/i)) return 'Power Tools';
    if (desc.match(/scanner|meter|scope|tester/i)) return 'Diagnostic Equipment';
    if (desc.match(/puller|press|spring|alignment/i)) return 'Specialty Tools';
    if (desc.match(/lift|jack|stand|crane/i)) return 'Shop Equipment';
    if (desc.match(/weld|torch|plasma|solder/i)) return 'Welding & Fabrication';
    if (desc.match(/gauge|micrometer|caliper|dial/i)) return 'Measurement Tools';
    if (desc.match(/glasses|gloves|mask|vest/i)) return 'Safety Equipment';
    
    return 'Hand Tools'; // Default category
  }

  /**
   * Convert file to base64
   */
  static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  }

  /**
   * Verify tool ownership with another professional
   */
  static async requestToolVerification(
    toolId: string,
    verifierId: string,
    verificationType: 'ownership' | 'condition' | 'value' | 'authenticity'
  ): Promise<void> {
    const { error } = await supabase
      .from('tool_verification')
      .insert({
        tool_id: toolId,
        verifier_id: verifierId,
        verification_type: verificationType,
        is_verified: true
      });
    
    if (error) throw error;
    
    // Update tool verification status
    await supabase
      .from('user_tools')
      .update({ 
        is_verified: true,
        verification_date: new Date().toISOString()
      })
      .eq('id', toolId);
  }

  /**
   * Get user's tools with full details
   * Only returns tools from active receipts (is_active = true)
   */
  static async getUserTools(userId: string) {
    // Simpler query: fetch user_tools only (join caused 400 due to missing FK in current schema)
    const { data, error } = await supabase
      .from('user_tools')
      .select('*')
      .eq('user_id', userId)
      .order('last_purchase_date', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('Error loading user tools:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get tool statistics for user (respects active receipts)
   */
  static async getToolStats(userId: string) {
    // Use getUserTools
    const tools = await this.getUserTools(userId);

    if (!tools || tools.length === 0) return {
      totalValue: 0,
      toolCount: 0,
      totalQuantity: 0,
      averageValue: 0
    };

    const totalValue = tools.reduce((sum, tool) => sum + (tool.total_spent || 0), 0);
    const totalQuantity = tools.reduce((sum, tool) => sum + (tool.total_quantity || 1), 0);
    const toolCount = tools.length;

    return {
      totalValue,
      toolCount,
      totalQuantity,
      averageValue: toolCount > 0 ? Number((totalValue / toolCount).toFixed(2)) : 0
    };
  }

  /**
   * Get all receipts for user with tool counts
   */
  static async getUserReceipts(userId: string) {
    const { data: receipts, error } = await supabase
      .from('receipts')
      .select(`
        *,
        items:line_items(count)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Error loading receipts:', error);
      return [];
    }
    
    return receipts || [];
  }

  /**
   * Toggle receipt visibility (show/hide all tools from this receipt)
   */
  static async toggleReceiptVisibility(receiptId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('receipts')
      .update({ is_active: isActive })
      .eq('id', receiptId);
    
    if (error) {
      console.error('Error toggling receipt:', error);
      throw error;
    }
  }

  /**
   * Delete receipt and all its tools permanently
   */
  static async deleteReceipt(receiptId: string): Promise<void> {
    // Delete all tools first
    const { error: toolsError } = await supabase
      .from('user_tools')
      .delete()
      .eq('receipt_document_id', receiptId);
    
    if (toolsError) {
      console.error('Error deleting tools:', toolsError);
      throw toolsError;
    }
    
    // Delete the receipt document
    const { error: receiptError } = await supabase
      .from('tool_receipt_documents')
      .delete()
      .eq('id', receiptId);
    
    if (receiptError) {
      console.error('Error deleting receipt:', receiptError);
      throw receiptError;
    }
  }

  /**
   * Rebuild user_tools from active receipts only
   * - Deletes only tools with metadata.source = 'receipt_import'
   * - Aggregates sale line_items grouped by part_number/description
   */
  static async regenerateInventoryFromActiveReceipts(userId: string): Promise<number> {
    // 1) Get active receipts
    const { data: receipts, error: recErr } = await supabase
      .from('receipts')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true);
    if (recErr) { console.error('Error loading receipts:', recErr); return 0; }
    const receiptIds = (receipts || []).map(r => r.id);
    if (receiptIds.length === 0) {
      // Clear receipt-imported tools and return
      await supabase.from('user_tools').delete().eq('user_id', userId).contains('metadata->>source', 'receipt_import');
      return 0;
    }

    // 2) Load all sale line items for active receipts
    const { data: items, error: liErr } = await supabase
      .from('line_items')
      .select('receipt_id, part_number, description, quantity, total_price, transaction_date, brand')
      .eq('user_id', userId)
      .in('receipt_id', receiptIds)
      .or('line_type.is.null,line_type.eq.sale');
    if (liErr) { console.error('Error loading line items:', liErr); return 0; }

    // 3) Aggregate in memory
    type Agg = {
      part_number?: string | null;
      description: string;
      total_quantity: number;
      total_spent: number;
      first_purchase_date?: string | null;
      last_purchase_date?: string | null;
      brand?: string | null;
      receipt_ids: string[];
    };
    const map = new Map<string, Agg>();
    for (const it of items || []) {
      const key = (it.part_number && it.part_number.length > 0)
        ? `pn:${it.part_number}`
        : `desc:${(it.description || '').toLowerCase()}`;
      const prev = map.get(key) || {
        part_number: it.part_number || null,
        description: it.description || 'Tool',
        total_quantity: 0,
        total_spent: 0,
        first_purchase_date: null,
        last_purchase_date: null,
        brand: it.brand || null,
        receipt_ids: []
      };
      prev.total_quantity += (it.quantity || 1);
      prev.total_spent += (it.total_price || 0);
      const d = it.transaction_date || null;
      if (!prev.first_purchase_date || (d && d < prev.first_purchase_date)) prev.first_purchase_date = d;
      if (!prev.last_purchase_date || (d && d > prev.last_purchase_date)) prev.last_purchase_date = d;
      if (it.receipt_id && !prev.receipt_ids.includes(it.receipt_id)) prev.receipt_ids.push(it.receipt_id);
      map.set(key, prev);
    }

    // 4) Delete existing receipt-imported tools for this user
    await supabase
      .from('user_tools')
      .delete()
      .eq('user_id', userId)
      .contains('metadata', { source: 'receipt_import' } as any);

    // 5) Insert aggregated tools
    const rows = Array.from(map.values()).map(a => ({
      user_id: userId,
      part_number: a.part_number,
      description: a.description,
      brand: a.brand,
      total_quantity: a.total_quantity,
      total_spent: a.total_spent,
      first_purchase_date: a.first_purchase_date,
      last_purchase_date: a.last_purchase_date,
      receipt_ids: a.receipt_ids,
      condition: 'new',
      metadata: { source: 'receipt_import', regenerated_at: new Date().toISOString() }
    }));
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('user_tools').insert(rows);
      if (insErr) { console.error('Error inserting rebuilt tools:', insErr); }
    }
    return rows.length;
  }
}
