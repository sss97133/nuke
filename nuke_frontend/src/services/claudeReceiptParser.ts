/**
 * Claude-powered receipt parser for professional tools
 * Uses Claude AI to intelligently extract tool information from receipts
 */

export interface ParsedTool {
  part_number: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  transaction_date?: string;
  transaction_number?: string;
  serial_number?: string;
  discount?: number;
  brand?: string;
}

export interface ClaudeReceiptParseResult {
  success: boolean;
  tools: ParsedTool[];
  summary: {
    total_amount: number;
    total_items: number;
    supplier: string;
    date: string;
    transaction_number?: string;
  };
  errors: string[];
  raw_response?: string;
}

export class ClaudeReceiptParser {
  private static CLAUDE_API_KEY = import.meta.env.VITE_NUKE_CLAUDE_API || import.meta.env.VITE_CLAUDE_API_KEY;

  /**
   * Convert file to base64 for image processing
   */
  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        // Remove data URL prefix to get just the base64 content
        const base64Content = base64.split(',')[1];
        resolve(base64Content);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Parse receipt from PDF file using Claude (document input)
   */
  static async parseReceiptDocument(pdfFile: File): Promise<ClaudeReceiptParseResult> {
    if (!this.CLAUDE_API_KEY) {
      return {
        success: false,
        tools: [],
        summary: {
          total_amount: 0,
          total_items: 0,
          supplier: 'Unknown',
          date: new Date().toISOString()
        },
        errors: ['Claude API key not configured. Please add VITE_NUKE_CLAUDE_API to your .env file']
      };
    }

    try {
      const base64Doc = await this.fileToBase64(pdfFile);
      const mediaType = 'application/pdf';

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.CLAUDE_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 8000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Doc
                  }
                },
                {
                  type: 'text',
                  text: `This is a TRANSACTION HISTORY receipt for professional tools. Extract EVERY SINGLE "SA" sale line as tool items.

Columns:
- Trans Date (date)
- Trans # (transaction number)
- Trans Type (SA = Sale, RA/EC = Payment)
- Product # (part number like AT4164, SOEXSA103, CT825HVDB)
- Description (tool name)
- Qty, List Price, Discount, Total

Rules:
1. ONLY include lines with Trans Type = "SA" (tools)
2. SKIP RA/EC payment lines
3. Use the rightmost value as total_price for each tool
4. Parse dates as YYYY-MM-DD
5. If qty missing, assume 1
6. Count ALL SA lines for total_items

Return JSON:
{
  "tools": [{
    "part_number": "...",
    "description": "...",
    "quantity": 1,
    "unit_price": 0,
    "total_price": 0,
    "transaction_date": "YYYY-MM-DD",
    "transaction_number": "...",
    "serial_number": null,
    "discount": 0,
    "brand": "Snap-on"
  }],
  "summary": {
    "total_amount": 0,
    "total_items": 0,
    "supplier": "Snap-on",
    "date": "YYYY-MM-DD",
    "transaction_number": "..."
  }
}

Return ONLY JSON.`
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude Document API error:', errorText);
        return {
          success: false,
          tools: [],
          summary: {
            total_amount: 0,
            total_items: 0,
            supplier: 'Unknown',
            date: new Date().toISOString()
          },
          errors: [`Claude Document API error: ${response.status}`]
        };
      }

      const data = await response.json();
      const content = data.content[0]?.text;
      if (!content) {
        throw new Error('No response from Claude Document API');
      }

      try {
        const parsed = JSON.parse(content);
        const tools = (parsed.tools || []).map((tool: any) => ({
          part_number: String(tool.part_number || ''),
          description: String(tool.description || ''),
          quantity: Number(tool.quantity) || 1,
          unit_price: Number(tool.unit_price) || 0,
          total_price: Number(tool.total_price) || Number(tool.unit_price) || 0,
          transaction_date: tool.transaction_date || parsed.summary?.date,
          transaction_number: tool.transaction_number || parsed.summary?.transaction_number,
          serial_number: tool.serial_number || null,
          discount: Number(tool.discount) || 0,
          brand: tool.brand || parsed.summary?.supplier || 'Unknown'
        })).filter((t: ParsedTool) => t.part_number && t.description && t.total_price > 0);

        return {
          success: true,
          tools,
          summary: {
            total_amount: Number(parsed.summary?.total_amount) || tools.reduce((s: number, t: ParsedTool) => s + t.total_price, 0),
            total_items: Number(parsed.summary?.total_items) || tools.length,
            supplier: parsed.summary?.supplier || 'Unknown',
            date: parsed.summary?.date || new Date().toISOString().split('T')[0],
            transaction_number: parsed.summary?.transaction_number
          },
          errors: [],
          raw_response: content
        };
      } catch (e) {
        console.error('Error parsing Claude Document response:', e);
        return {
          success: false,
          tools: [],
          summary: {
            total_amount: 0,
            total_items: 0,
            supplier: 'Unknown',
            date: new Date().toISOString()
          },
          errors: ['Failed to parse receipt data from PDF document']
        };
      }

    } catch (error) {
      console.error('Error calling Claude Document API:', error);
      return {
        success: false,
        tools: [],
        summary: {
          total_amount: 0,
          total_items: 0,
          supplier: 'Unknown',
          date: new Date().toISOString()
        },
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Parse receipt from image file using Claude Vision
   */
  static async parseReceiptImage(imageFile: File): Promise<ClaudeReceiptParseResult> {
    if (!this.CLAUDE_API_KEY) {
      return {
        success: false,
        tools: [],
        summary: {
          total_amount: 0,
          total_items: 0,
          supplier: 'Unknown',
          date: new Date().toISOString()
        },
        errors: ['Claude API key not configured. Please add VITE_NUKE_CLAUDE_API to your .env file']
      };
    }

    try {
      const base64Image = await this.fileToBase64(imageFile);
      const mediaType = imageFile.type;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.CLAUDE_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 8000,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Image
                  }
                },
                {
                  type: 'text',
                  text: `This is a TRANSACTION HISTORY receipt for professional tools. Extract EVERY SINGLE TOOL line where the column 'Line Type' is 'Sale'.

This receipt has these columns:
- Trans Date (date)
- Trans # (transaction number)
- Product # (part number like AT4164, SOEXSA103, CRK3801)
- Description (tool name like "25MM RUBBER NOZZLE", "19PC SOEX SAE")
- Qty (quantity)
- List Price (original price)
- Discount (discount amount)
- Total (final price after discount)
- Line Type (Sale | Warranty | Return | etc.)
- Pmt Amt (payment amount)
- Pmt Type (RA/EC/etc)
- Serial # (optional)

CRITICAL PARSING RULES:
1. ONLY include rows where 'Line Type' = 'Sale' (these are tool purchases)
2. IGNORE payment info in 'Pmt Amt'/'Pmt Type' columns
3. Use the 'Total' column as total_price for each tool
4. Parse dates (MM/DD/YYYY or similar) to YYYY-MM-DD
5. If quantity is not shown, assume 1
6. Count ALL rows with 'Line Type' = 'Sale' for total_items

Return a JSON object with this EXACT structure:

{
  "tools": [
    {
      "part_number": "AT4164",
      "description": "25MM RUBBER NOZZLE",
      "quantity": 1,
      "unit_price": 50.00,
      "total_price": 50.00,
      "transaction_date": "2024-09-22",
      "transaction_number": "09222540712",
      "serial_number": null,
      "discount": 0.00,
      "brand": "Snap-on"
    }
  ],
  "summary": {
    "total_amount": 1234.56,
    "total_items": 113,
    "supplier": "Snap-on",
    "date": "2024-09-22",
    "transaction_number": "09222540712"
  }
}

BE THOROUGH: The receipt may have 50-150+ tool items. Extract EVERY SINGLE ONE.

Return ONLY the JSON object, no explanation or markdown.`
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude Vision API error:', errorText);
        return {
          success: false,
          tools: [],
          summary: {
            total_amount: 0,
            total_items: 0,
            supplier: 'Unknown',
            date: new Date().toISOString()
          },
          errors: [`Claude Vision API error: ${response.status}`]
        };
      }

      const data = await response.json();
      console.log('Claude Vision API Response:', data); // Debug log
      
      const content = data.content[0]?.text;

      if (!content) {
        console.error('Empty Claude Vision response:', data);
        throw new Error('No response from Claude Vision');
      }
      
      console.log('Claude Vision extracted content:', content.substring(0, 500)); // Debug first 500 chars

      // Parse the JSON response
      try {
        const parsed = JSON.parse(content);
        
        const tools = (parsed.tools || []).map((tool: any) => ({
          part_number: String(tool.part_number || ''),
          description: String(tool.description || ''),
          quantity: Number(tool.quantity) || 1,
          unit_price: Number(tool.unit_price) || 0,
          total_price: Number(tool.total_price) || Number(tool.unit_price) || 0,
          transaction_date: tool.transaction_date || parsed.summary?.date,
          transaction_number: tool.transaction_number || parsed.summary?.transaction_number,
          serial_number: tool.serial_number || null,
          discount: Number(tool.discount) || 0,
          brand: tool.brand || parsed.summary?.supplier || 'Unknown'
        })).filter((tool: ParsedTool) => 
          tool.part_number && tool.description && tool.unit_price > 0
        );

        return {
          success: true,
          tools,
          summary: {
            total_amount: Number(parsed.summary?.total_amount) || tools.reduce((sum: number, t: ParsedTool) => sum + t.total_price, 0),
            total_items: Number(parsed.summary?.total_items) || tools.length,
            supplier: parsed.summary?.supplier || 'Unknown',
            date: parsed.summary?.date || new Date().toISOString().split('T')[0],
            transaction_number: parsed.summary?.transaction_number
          },
          errors: [],
          raw_response: content
        };

      } catch (parseError) {
        console.error('Error parsing Claude Vision response:', parseError);
        return {
          success: false,
          tools: [],
          summary: {
            total_amount: 0,
            total_items: 0,
            supplier: 'Unknown',
            date: new Date().toISOString()
          },
          errors: ['Failed to parse receipt data from image']
        };
      }

    } catch (error) {
      console.error('Error calling Claude Vision API:', error);
      return {
        success: false,
        tools: [],
        summary: {
          total_amount: 0,
          total_items: 0,
          supplier: 'Unknown',
          date: new Date().toISOString()
        },
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Parse receipt text using Claude AI
   */
  static async parseReceipt(receiptText: string): Promise<ClaudeReceiptParseResult> {
    if (!this.CLAUDE_API_KEY) {
      return {
        success: false,
        tools: [],
        summary: {
          total_amount: 0,
          total_items: 0,
          supplier: 'Unknown',
          date: new Date().toISOString()
        },
        errors: ['Claude API key not configured. Please add VITE_NUKE_CLAUDE_API to your .env file']
      };
    }

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.CLAUDE_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 8000,
          messages: [
            {
              role: 'user',
              content: `You are a receipt parsing assistant specialized in TRANSACTION HISTORY receipts (Snap-on, Mac Tools, Matco, etc.).

Columns:
- Trans Date, Trans #, Product #, Description, Qty, List Price, Discount, Total, Line Type, Pmt Amt, Pmt Type, Serial #

CRITICAL PARSING RULES:
1. ONLY extract rows where 'Line Type' = 'Sale' (tool purchases)
2. SKIP payment columns 'Pmt Amt'/'Pmt Type' (not items)
3. Use 'Total' column as total_price
4. Parse dates to YYYY-MM-DD format
5. Default quantity to 1 if not specified
6. Count ALL 'Line Type' = 'Sale' rows for total_items

Return a JSON object with this EXACT structure:

{
  "tools": [
    {
      "part_number": "AT4164",
      "description": "25MM RUBBER NOZZLE",
      "quantity": 1,
      "unit_price": 50.00,
      "total_price": 50.00,
      "transaction_date": "2025-09-22",
      "transaction_number": "09222540712",
      "serial_number": null,
      "discount": 0.00,
      "brand": "Snap-on"
    }
  ],
  "summary": {
    "total_amount": 15000.00,
    "total_items": 113,
    "supplier": "Snap-on",
    "date": "2025-09-22",
    "transaction_number": "09222540712"
  }
}

BE THOROUGH: Transaction histories can have 50-150+ tools. Extract EVERY "SA" line.

Receipt text to parse:
${receiptText}

Return ONLY the JSON object, no explanation or markdown.`
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Claude API error:', errorText);
        return {
          success: false,
          tools: [],
          summary: {
            total_amount: 0,
            total_items: 0,
            supplier: 'Unknown',
            date: new Date().toISOString()
          },
          errors: [`Claude API error: ${response.status}`]
        };
      }

      const data = await response.json();
      console.log('Claude API Response:', data); // Debug log
      
      const content = data.content[0]?.text;

      if (!content) {
        console.error('Empty Claude response:', data);
        throw new Error('No response from Claude');
      }
      
      console.log('Claude extracted content:', content.substring(0, 500)); // Debug first 500 chars

      // Parse Claude's JSON response
      try {
        const parsed = JSON.parse(content);
        
        // Validate and clean the parsed data
        const tools = (parsed.tools || []).map((tool: any) => ({
          part_number: String(tool.part_number || ''),
          description: String(tool.description || ''),
          quantity: Number(tool.quantity) || 1,
          unit_price: Number(tool.unit_price) || 0,
          total_price: Number(tool.total_price) || Number(tool.unit_price) || 0,
          transaction_date: tool.transaction_date || parsed.summary?.date,
          transaction_number: tool.transaction_number || parsed.summary?.transaction_number,
          serial_number: tool.serial_number || null,
          discount: Number(tool.discount) || 0,
          brand: tool.brand || parsed.summary?.supplier || 'Unknown'
        })).filter((tool: ParsedTool) => 
          tool.part_number && tool.description && tool.unit_price > 0
        );

        return {
          success: true,
          tools,
          summary: {
            total_amount: Number(parsed.summary?.total_amount) || tools.reduce((sum: number, t: ParsedTool) => sum + t.total_price, 0),
            total_items: Number(parsed.summary?.total_items) || tools.length,
            supplier: parsed.summary?.supplier || 'Unknown',
            date: parsed.summary?.date || new Date().toISOString().split('T')[0],
            transaction_number: parsed.summary?.transaction_number
          },
          errors: [],
          raw_response: content
        };

      } catch (parseError) {
        console.error('Error parsing Claude response:', parseError);
        console.log('Raw response:', content);
        
        // Try to extract what we can even if JSON parsing fails
        return this.fallbackParse(receiptText, content);
      }

    } catch (error) {
      console.error('Error calling Claude API:', error);
      return {
        success: false,
        tools: [],
        summary: {
          total_amount: 0,
          total_items: 0,
          supplier: 'Unknown',
          date: new Date().toISOString()
        },
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Fallback parser if Claude's response isn't valid JSON
   */
  private static fallbackParse(receiptText: string, claudeResponse: string): ClaudeReceiptParseResult {
    // Try to extract tools using regex patterns
    const tools: ParsedTool[] = [];
    const lines = receiptText.split('\n');
    
    // Common patterns for Snap-on receipts
    const toolPattern = /([A-Z0-9]+)\s+(.+?)\s+(\d+)\s+(\d+\.?\d*)\s+(\d+\.?\d*)/;
    const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
    
    for (const line of lines) {
      const match = line.match(toolPattern);
      if (match) {
        const [, partNumber, description, qty, unitPrice, total] = match;
        
        // Skip payment lines
        if (['RA', 'EC', 'PMT', 'PAYMENT'].some(term => partNumber.includes(term))) {
          continue;
        }
        
        tools.push({
          part_number: partNumber,
          description: description.trim(),
          quantity: parseInt(qty),
          unit_price: parseFloat(unitPrice),
          total_price: parseFloat(total),
          brand: 'Snap-on' // Default for now
        });
      }
    }

    // Try to find date
    let date = new Date().toISOString().split('T')[0];
    const dateMatch = receiptText.match(datePattern);
    if (dateMatch) {
      const parsedDate = new Date(dateMatch[1]);
      if (!isNaN(parsedDate.getTime())) {
        date = parsedDate.toISOString().split('T')[0];
      }
    }

    return {
      success: tools.length > 0,
      tools,
      summary: {
        total_amount: tools.reduce((sum, t) => sum + t.total_price, 0),
        total_items: tools.length,
        supplier: 'Snap-on',
        date
      },
      errors: tools.length === 0 ? ['No tools found in receipt'] : [],
      raw_response: claudeResponse
    };
  }

  /**
   * Enhanced parsing for PDF receipts (requires text extraction first)
   */
  static async parsePDFReceipt(pdfText: string): Promise<ClaudeReceiptParseResult> {
    // PDFs often have formatting issues, so we'll pre-process the text
    const cleanedText = this.cleanPDFText(pdfText);
    return this.parseReceipt(cleanedText);
  }

  /**
   * Clean up PDF-extracted text
   */
  private static cleanPDFText(text: string): string {
    // Remove excessive whitespace
    let cleaned = text.replace(/\s+/g, ' ');
    
    // Fix common PDF extraction issues
    cleaned = cleaned.replace(/(\d)\s+(\d{2,})/g, '$1$2'); // Fix split numbers
    cleaned = cleaned.replace(/\$\s+(\d)/g, '$$$1'); // Fix split dollar signs
    
    // Try to restore line breaks at logical points
    cleaned = cleaned.replace(/(\d{2}\/\d{2}\/\d{4})/g, '\n$1'); // New line before dates
    cleaned = cleaned.replace(/([A-Z]{2,}\d+)\s+/g, '\n$1 '); // New line before part numbers
    
    return cleaned;
  }

  /**
   * Validate parsed tools before saving
   */
  static validateTools(tools: ParsedTool[]): { valid: ParsedTool[], invalid: ParsedTool[], errors: string[] } {
    const valid: ParsedTool[] = [];
    const invalid: ParsedTool[] = [];
    const errors: string[] = [];

    for (const tool of tools) {
      const toolErrors: string[] = [];

      // Validate required fields
      if (!tool.part_number || tool.part_number.length < 2) {
        toolErrors.push('Invalid part number');
      }
      if (!tool.description || tool.description.length < 3) {
        toolErrors.push('Invalid description');
      }
      if (tool.unit_price <= 0) {
        toolErrors.push('Invalid price');
      }
      if (tool.quantity <= 0) {
        toolErrors.push('Invalid quantity');
      }

      if (toolErrors.length === 0) {
        valid.push(tool);
      } else {
        invalid.push(tool);
        errors.push(`${tool.part_number || 'Unknown'}: ${toolErrors.join(', ')}`);
      }
    }

    return { valid, invalid, errors };
  }
}

// Export a convenience function for direct use
export async function parseToolReceipt(receiptText: string): Promise<ClaudeReceiptParseResult> {
  return ClaudeReceiptParser.parseReceipt(receiptText);
}
