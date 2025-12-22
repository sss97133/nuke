import type { ParsedTool } from './types/toolTypes';
import { aiGateway } from '../lib/aiGateway';

export class OpenAIReceiptParser {
  static async parseWithVision(file: File, apiKey: string): Promise<ParsedTool[]> {
    try {
      // Convert file to base64
      const base64 = await this.fileToBase64(file);
      const imageUrl = `data:${file.type};base64,${base64}`;

      const requestPayload = {
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract ALL tools from this Snap-on transaction history receipt.
              For each tool line item, extract:
              - part_number (product code like AT4164, SOEXSA103, etc)
              - name (product description)
              - purchase_price (the total price, not list price)
              - purchase_date (transaction date)

              Skip payment lines (RA, EC entries).
              Return as JSON array with these exact field names.
              Include ALL tools you can find.`
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'high' }
            }
          ]
        }],
        max_tokens: 4096,
        temperature: 0.1
      };

      // Get caching configuration for receipt extraction
      const cachingConfig = aiGateway.getCachingConfig('receipt-extraction');

      let content: string;

      // Try using AI Gateway first
      try {
        const gatewayResult = await aiGateway.makeRequest(
          'openai',
          'gpt-4o',
          requestPayload,
          {
            cache: cachingConfig.cache,
            cacheTTL: cachingConfig.cacheTTL,
            fallback: true
          }
        );

        if (gatewayResult?.choices?.[0]?.message?.content) {
          content = gatewayResult.choices[0].message.content;
        } else {
          throw new Error('Invalid gateway response');
        }
      } catch (gatewayError) {
        console.warn('AI Gateway failed for receipt parsing, falling back to direct API:', gatewayError);

        // Fallback to direct OpenAI API
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload)
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        content = data.choices[0].message.content;
      }
      
      // Parse the JSON response
      const extracted = JSON.parse(content);
      
      // Convert to our format
      return extracted.map((item: any) => ({
        name: item.name || item.description,
        part_number: item.part_number,
        brand_name: 'Snap-on',
        purchase_date: item.purchase_date,
        purchase_price: parseFloat(item.purchase_price) || 0,
        quantity: 1,
        category: this.categorize(item.name || ''),
        metadata: {
          source: 'openai-vision'
        }
      }));
      
    } catch (error) {
      console.error('OpenAI Vision parsing failed:', error);
      throw error;
    }
  }
  
  private static async fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  }
  
  private static categorize(desc: string): string {
    const d = desc.toUpperCase();
    if (d.includes('WRENCH') || d.includes('RATCHET')) return 'Hand Tools';
    if (d.includes('IMPACT') || d.includes('DRILL')) return 'Power Tools';
    if (d.includes('SOCKET') || d.includes('SOEX')) return 'Sockets';
    if (d.includes('PLIER')) return 'Pliers';
    if (d.includes('METER') || d.includes('GAUGE')) return 'Measuring';
    if (d.includes('BATTERY')) return 'Batteries';
    return 'Tools';
  }
}
