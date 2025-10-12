import { supabase } from '../lib/supabase';

interface ToolReceiptLine {
  transaction_date: string;
  transaction_number: string;
  transaction_type: string;
  part_number: string;
  description: string;
  quantity: number;
  list_price: number;
  discount: number;
  total_amount: number;
  payment_type: string;
  serial_number?: string;
}

interface SnapOnProduct {
  part_number: string;
  url: string;
  name: string;
  price: number;
  image_url: string;
  description: string;
  specifications?: any;
}

export class ToolInventoryService {
  /**
   * Parse Snap-on receipt PDF text
   */
  static parseSnapOnReceipt(pdfText: string): ToolReceiptLine[] {
    const lines: ToolReceiptLine[] = [];
    const processedTransactions = new Set<string>();
    
    // Split into lines and process
    const rows = pdfText.split('\n');
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Look for lines that start with a date (transaction lines)
      const datePattern = /^(\d{1,2}\/\d{1,2}\/\d{4})/;
      const dateMatch = row.match(datePattern);
      
      if (dateMatch) {
        // This looks like a transaction line
        // Sometimes the data spans multiple lines, so collect it
        let fullLine = row;
        
        // Check if next line contains the product code
        if (i + 1 < rows.length && rows[i + 1].match(/^[A-Z0-9]+\s/)) {
          fullLine += ' ' + rows[i + 1];
          i++; // Skip the next line since we've processed it
        }
        
        // Enhanced pattern to match various formats in the receipt
        // Date TransNum Type PartNum Description Qty Price Discount Total
        const patterns = [
          // Standard sale line: 10/7/202410072425384 RA FR80 3/8DR 80T STD Q/R RAT 1 150.50 25.00 125.50 Sale
          /(\d{1,2}\/\d{1,2}\/\d{4})(\d+)\s+(RA|Sale|Return|Warranty|EC)\s+([A-Z0-9]+)\s+(.*?)\s+(-?\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+(Sale|RA|EC|Return|Warranty)/,
          // Alternative format without trailing type
          /(\d{1,2}\/\d{1,2}\/\d{4})(\d+)\s+(RA|Sale|Return|Warranty|EC)\s+([A-Z0-9]+)\s+(.*?)\s+(-?\d+)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)?/,
          // Format with just date and type (for RA/EC lines without products)
          /(\d{1,2}\/\d{1,2}\/\d{4})(\d+)\s+(RA|EC|Warranty|Return)\s*$/
        ];
        
        let matched = false;
        for (const pattern of patterns) {
          const match = fullLine.match(pattern);
          if (match && match[4]) { // Only process if we have a part number
            const transKey = `${match[2]}-${match[4]}`; // transaction number + part number
            
            // Skip if we've already processed this exact transaction
            if (processedTransactions.has(transKey)) continue;
            
            processedTransactions.add(transKey);
            
            // Only add Sales transactions (skip RA, EC, Warranty, etc. for now)
            if (match[3] === 'Sale' || (match[10] === 'Sale')) {
              lines.push({
                transaction_date: match[1],
                transaction_number: match[2],
                transaction_type: 'Sale',
                part_number: match[4],
                description: match[5] ? match[5].trim() : '',
                quantity: match[6] ? parseInt(match[6]) : 1,
                list_price: match[7] ? parseFloat(match[7].replace(/,/g, '')) : 0,
                discount: match[8] ? parseFloat(match[8].replace(/,/g, '')) : 0,
                total_amount: match[9] ? parseFloat(match[9].replace(/,/g, '')) : 0,
                payment_type: 'Sale',
                serial_number: undefined
              });
            }
            matched = true;
            break;
          }
        }
        
        // If we didn't match with the complex patterns, try a simpler approach
        if (!matched) {
          // Look for lines with part numbers in the expected position
          const simplePattern = /([A-Z][A-Z0-9]+)\s+(.+?)\s+(\d+)\s+([\d,]+\.?\d*)/;
          const simpleMatch = fullLine.match(simplePattern);
          if (simpleMatch && fullLine.includes('Sale')) {
            const transNum = fullLine.match(/(\d{14,})/)?.[1] || '';
            const transKey = `${transNum}-${simpleMatch[1]}`;
            
            if (!processedTransactions.has(transKey)) {
              processedTransactions.add(transKey);
              lines.push({
                transaction_date: dateMatch[1],
                transaction_number: transNum,
                transaction_type: 'Sale',
                part_number: simpleMatch[1],
                description: simpleMatch[2].trim(),
                quantity: parseInt(simpleMatch[3]),
                list_price: parseFloat(simpleMatch[4].replace(/,/g, '')),
                discount: 0,
                total_amount: parseFloat(simpleMatch[4].replace(/,/g, '')),
                payment_type: 'Sale',
                serial_number: undefined
              });
            }
          }
        }
      }
    }
    
    // Filter out invalid entries
    return lines.filter(line => 
      line.part_number && 
      line.part_number.length > 0 && 
      line.description && 
      line.total_amount > 0
    );
  }

  /**
   * Search for Snap-on product by part number
   */
  static async searchSnapOnProduct(partNumber: string): Promise<SnapOnProduct | null> {
    try {
      // First, try to construct the direct URL pattern
      const baseUrl = 'https://shop.snapon.com/product/';
      
      // Use a web scraping service or API to get the actual URL
      // For now, we'll use Google search API or a scraping service
      // This is a placeholder - you'd need to implement actual web scraping
      
      const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(partNumber + ' site:shop.snapon.com')}&key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}`;
      
      // For demo purposes, construct a likely URL
      const productUrl = `${baseUrl}${partNumber}`;
      
      return {
        part_number: partNumber,
        url: productUrl,
        name: '',
        price: 0,
        image_url: '',
        description: '',
        specifications: {}
      };
    } catch (error) {
      console.error('Error searching for product:', error);
      return null;
    }
  }

  /**
   * Import tools from parsed receipt
   */
  static async importToolsFromReceipt(
    userId: string,
    receiptLines: ToolReceiptLine[],
    franchiseOperatorId?: string
  ) {
    const results = [];
    
    // Get or create Snap-on brand
    const { data: brand } = await supabase
      .from('tool_brands')
      .select('id')
      .eq('name', 'Snap-on')
      .single();
    
    if (!brand) {
      throw new Error('Snap-on brand not found');
    }
    
    for (const line of receiptLines) {
      // Skip non-sale transactions for now
      if (line.transaction_type !== 'Sale') continue;
      
      try {
        // Check if tool exists in catalog
        let { data: catalogItem } = await supabase
          .from('tool_catalog')
          .select('id')
          .eq('brand_id', brand.id)
          .eq('part_number', line.part_number)
          .single();
        
        // If not in catalog, search and add it
        if (!catalogItem) {
          const product = await this.searchSnapOnProduct(line.part_number);
          
          const { data: newCatalogItem } = await supabase
            .from('tool_catalog')
            .insert({
              brand_id: brand.id,
              part_number: line.part_number,
              description: line.description,
              list_price: line.list_price,
              product_url: product?.url,
              brochure_image_url: product?.image_url,
              category: this.categorizeToolByDescription(line.description)
            })
            .select('id')
            .single();
          
          catalogItem = newCatalogItem;
        }
        
        // Add to user's inventory
        if (catalogItem) {
          const { data: userTool } = await supabase
            .from('user_tools')
            .insert({
              user_id: userId,
              catalog_id: catalogItem.id,
              transaction_number: line.transaction_number,
              transaction_date: line.transaction_date,
              purchase_price: line.total_amount,
              discount_amount: line.discount,
              serial_number: line.serial_number,
              franchise_operator_id: franchiseOperatorId
            })
            .select()
            .single();
          
          results.push(userTool);
        }
      } catch (error) {
        console.error(`Error importing tool ${line.part_number}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Categorize tool based on description
   */
  static categorizeToolByDescription(description: string): string {
    const desc = description.toLowerCase();
    
    if (desc.includes('socket') || desc.includes('skt')) return 'Sockets';
    if (desc.includes('wrench') || desc.includes('wrnch')) return 'Wrenches';
    if (desc.includes('ratchet') || desc.includes('rat')) return 'Ratchets';
    if (desc.includes('plier')) return 'Pliers';
    if (desc.includes('hammer') || desc.includes('hm')) return 'Hammers';
    if (desc.includes('screwdriver') || desc.includes('scr')) return 'Screwdrivers';
    if (desc.includes('impact')) return 'Power Tools';
    if (desc.includes('drill')) return 'Power Tools';
    if (desc.includes('grinder')) return 'Power Tools';
    if (desc.includes('battery')) return 'Batteries';
    if (desc.includes('charger')) return 'Chargers';
    if (desc.includes('tester') || desc.includes('meter')) return 'Electrical';
    if (desc.includes('pry') || desc.includes('bar')) return 'Pry Bars';
    if (desc.includes('pick')) return 'Picks';
    if (desc.includes('gauge') || desc.includes('compression')) return 'Specialty';
    
    return 'Misc Tools';
  }

  /**
   * Get user's tool inventory
   */
  static async getUserTools(userId: string) {
    const { data, error } = await supabase
      .from('user_tools')
      .select(`
        *,
        catalog:tool_catalog(
          *,
          brand:tool_brands(*)
        ),
        images:tool_images(*),
        warranties:tool_warranties(*)
      `)
      .eq('user_id', userId)
      .order('transaction_date', { ascending: false });
    
    if (error) throw error;
    return data;
  }

  /**
   * Get tool inventory statistics
   */
  static async getToolStats(userId: string) {
    const { data, error } = await supabase
      .rpc('calculate_tool_inventory_value', { p_user_id: userId });
    
    if (error) throw error;
    return data?.[0] || { total_value: 0, tool_count: 0, brand_breakdown: {} };
  }

  /**
   * Add manual tool entry
   */
  static async addManualTool(
    userId: string,
    partNumber: string,
    description: string,
    purchasePrice: number,
    transactionDate: string,
    serialNumber?: string
  ) {
    // Get Snap-on brand
    const { data: brand } = await supabase
      .from('tool_brands')
      .select('id')
      .eq('name', 'Snap-on')
      .single();
    
    if (!brand) throw new Error('Brand not found');
    
    // Check or create catalog entry
    let { data: catalogItem } = await supabase
      .from('tool_catalog')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('part_number', partNumber)
      .single();
    
    if (!catalogItem) {
      const product = await this.searchSnapOnProduct(partNumber);
      
      const { data: newItem } = await supabase
        .from('tool_catalog')
        .insert({
          brand_id: brand.id,
          part_number: partNumber,
          description: description,
          product_url: product?.url,
          category: this.categorizeToolByDescription(description)
        })
        .select()
        .single();
      
      catalogItem = newItem;
    }
    
    // Add to user inventory
    const { data, error } = await supabase
      .from('user_tools')
      .insert({
        user_id: userId,
        catalog_id: catalogItem!.id,
        transaction_date: transactionDate,
        purchase_price: purchasePrice,
        serial_number: serialNumber
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
}
