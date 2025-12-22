/**
 * Fallback Receipt Parser
 * Works without Claude API - uses pattern matching for basic parsing
 */

import type { UniversalReceiptResult } from './types/receiptTypes';

export class FallbackReceiptParser {
  /**
   * Parse receipt text using pattern matching (no AI required)
   */
  static async parseReceiptText(text: string): Promise<UniversalReceiptResult> {
    console.log('Using fallback parser (no Claude API)...');
    
    const lines = text.split('\n').filter(l => l.trim());
    const lineItems: any[] = [];
    
    // Common patterns for prices
    const pricePattern = /\$?\d+[\.,]\d{2}/g;
    const partNumberPattern = /\b[A-Z0-9]{3,}[A-Z0-9\-]*\b/g;
    
    // Try to extract vendor name
    let vendorName = 'Unknown Vendor';
    const vendorPatterns = [
      /snap[\-\s]?on/i,
      /matco/i,
      /mac\s?tools/i,
      /harbor\s?freight/i,
      /home\s?depot/i,
      /lowes/i
    ];
    
    for (const pattern of vendorPatterns) {
      if (pattern.test(text)) {
        vendorName = text.match(pattern)?.[0] || vendorName;
        break;
      }
    }
    
    // Extract date
    const datePattern = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/;
    const dateMatch = text.match(datePattern);
    const receiptDate = dateMatch ? new Date(dateMatch[0]) : new Date();
    
    // Extract total
    const totalPattern = /total[\s:]*\$?([\d,]+\.?\d*)/i;
    const totalMatch = text.match(totalPattern);
    const totalAmount = totalMatch ? parseFloat(totalMatch[1].replace(',', '')) : 0;
    
    // Try to extract line items
    for (const line of lines) {
      const prices = line.match(pricePattern);
      const partNumbers = line.match(partNumberPattern);
      
      if (prices && prices.length > 0) {
        const price = parseFloat(prices[0].replace('$', '').replace(',', ''));
        
        // Extract description (everything before the price)
        const priceIndex = line.indexOf(prices[0]);
        let description = line.substring(0, priceIndex).trim();
        
        if (!description) {
          description = 'Item';
        }
        
        lineItems.push({
          line_type: 'sale',
          part_number: partNumbers?.[0] || null,
          description: description,
          quantity: 1,
          unit_price: price,
          total_price: price,
          category: this.guessCategory(description),
          brand: this.guessBrand(description)
        });
      }
    }
    
    // If no items found, create a single item from the total
    if (lineItems.length === 0 && totalAmount > 0) {
      lineItems.push({
        line_type: 'sale',
        part_number: null,
        description: 'Receipt Total - Manual Entry Required',
        quantity: 1,
        unit_price: totalAmount,
        total_price: totalAmount,
        category: 'Uncategorized',
        brand: vendorName
      });
    }
    
    return {
      success: lineItems.length > 0,
      confidence_score: 0.3, // Low confidence for fallback parser
      line_items: lineItems,
      payment_records: [],
      receipt_metadata: {
        vendor_name: vendorName,
        transaction_date: receiptDate.toISOString(),
        total_amount: totalAmount || lineItems.reduce((sum, item) => sum + item.total_price, 0),
        transaction_number: undefined,
        vendor_address: undefined
      },
      raw_extraction: {
        method: 'fallback_parser',
        patterns_used: ['price', 'part_number', 'vendor'],
        text_length: text.length
      },
      errors: lineItems.length === 0 ? ['No items could be extracted using pattern matching'] : []
    };
  }
  
  private static guessCategory(description: string): string {
    const desc = description.toLowerCase();
    
    if (desc.includes('socket') || desc.includes('wrench')) return 'Hand Tools';
    if (desc.includes('ratchet')) return 'Hand Tools';
    if (desc.includes('drill') || desc.includes('impact')) return 'Power Tools';
    if (desc.includes('battery') || desc.includes('charger')) return 'Power Tool Accessories';
    if (desc.includes('box') || desc.includes('chest')) return 'Tool Storage';
    if (desc.includes('gauge') || desc.includes('meter')) return 'Diagnostic Tools';
    if (desc.includes('jack') || desc.includes('stand')) return 'Shop Equipment';
    
    return 'Tools';
  }
  
  private static guessBrand(description: string): string {
    const desc = description.toLowerCase();
    
    if (desc.includes('snap-on') || desc.includes('snapon')) return 'Snap-on';
    if (desc.includes('matco')) return 'Matco';
    if (desc.includes('mac')) return 'Mac Tools';
    if (desc.includes('milwaukee')) return 'Milwaukee';
    if (desc.includes('dewalt')) return 'DeWalt';
    if (desc.includes('craftsman')) return 'Craftsman';
    
    return 'Unknown';
  }
}
