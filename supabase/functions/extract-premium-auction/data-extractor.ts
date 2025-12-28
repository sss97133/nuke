/**
 * Extract data using the strategy map from LLM structure analysis
 * This executes the extraction based on the map, not using LLM again
 */

/**
 * Extract data from __NEXT_DATA__ JSON - smart search if no map provided
 */
export function extractFromNextData(
  html: string,
  extractionMap?: Record<string, string>
): Record<string, any> {
  const extracted: Record<string, any> = {};
  
  try {
    // Find __NEXT_DATA__ script tag
    const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!nextDataMatch || !nextDataMatch[1]) {
      console.log('⚠️ No __NEXT_DATA__ found in HTML');
      return extracted;
    }
    
    const jsonStr = nextDataMatch[1].trim();
    const nextData = JSON.parse(jsonStr);
    
    // Navigate to auction/listing data (common Next.js patterns)
    const auction = nextData?.props?.pageProps?.auction || 
                   nextData?.props?.pageProps?.data?.auction ||
                   nextData?.props?.pageProps?.listing ||
                   nextData?.props?.auction ||
                   nextData?.auction ||
                   nextData?.props?.pageProps;
    
    if (!auction) {
      console.log('⚠️ Could not find auction/listing object in __NEXT_DATA__');
      return extracted;
    }
    
    // If we have an extraction map, use it
    if (extractionMap && Object.keys(extractionMap).length > 0) {
      for (const [field, path] of Object.entries(extractionMap)) {
        if (!path || !path.includes('__NEXT_DATA__')) continue;
        
        try {
          const pathParts = path.replace(/^__NEXT_DATA__\.?/, '').replace(/^props\.pageProps\.(auction|listing)\.?/, '').split('.');
          let value: any = auction;
          
          for (const part of pathParts) {
            if (value && typeof value === 'object' && part in value) {
              value = value[part];
            } else {
              value = null;
              break;
            }
          }
          
          if (value !== null && value !== undefined) {
            extracted[field] = value;
            console.log(`✅ Extracted ${field} from ${path}: ${value}`);
          }
        } catch (e) {
          console.warn(`⚠️ Failed to extract ${field} from path ${path}:`, e);
        }
      }
    } else {
      // No map - smart search for common field names
      const fieldMappings: Record<string, string[]> = {
        mileage: ['mileage', 'odometer', 'miles', 'odometerReading'],
        color: ['color', 'exteriorColor', 'exterior_color', 'paintColor'],
        transmission: ['transmission', 'trans', 'transmissionType'],
        engine_size: ['engine', 'engineSize', 'engine_size', 'engineDescription', 'displacement'],
        vin: ['vin', 'vehicleIdentificationNumber', 'vehicle_id'],
      };
      
      for (const [field, possibleKeys] of Object.entries(fieldMappings)) {
        for (const key of possibleKeys) {
          if (auction[key] !== null && auction[key] !== undefined) {
            extracted[field] = auction[key];
            console.log(`✅ Found ${field} as '${key}': ${auction[key]}`);
            break;
          }
        }
      }
    }
  } catch (error) {
    console.warn(`⚠️ Failed to parse __NEXT_DATA__:`, error);
  }
  
  return extracted;
}

/**
 * Extract data using CSS selectors from HTML
 */
export function extractFromCSSSelectors(
  html: string,
  extractionMap: Record<string, string>
): Record<string, any> {
  const extracted: Record<string, any> = {};
  
  // This would require a DOM parser - for now, use regex as fallback
  // In a real implementation, you'd use deno-dom or similar
  
  for (const [field, selector] of Object.entries(extractionMap)) {
    if (!selector || selector.includes('__NEXT_DATA__')) continue;
    
    // Simple regex extraction for common patterns
    // This is a basic implementation - could be improved
    try {
      const regex = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const match = html.match(regex);
      if (match && match[1]) {
        extracted[field] = match[1].trim();
        console.log(`✅ Extracted ${field} using selector: ${selector}`);
      }
    } catch (e) {
      // Invalid regex, skip
    }
  }
  
  return extracted;
}

/**
 * Main extraction function - uses the strategy map to extract data
 */
export function extractUsingStrategy(
  html: string,
  strategy: Record<string, any>,
  extractionMap: Record<string, string>
): Record<string, any> {
  const strategyType = strategy.extraction_strategy || 'parse_json'; // Default to JSON parsing
  
  console.log(`📋 Using extraction strategy: ${strategyType}`);
  
  // Always try __NEXT_DATA__ first (Cars & Bids uses Next.js)
  if (html.includes('__NEXT_DATA__')) {
    console.log('✅ Found __NEXT_DATA__, extracting from JSON...');
    const jsonExtracted = extractFromNextData(html, extractionMap);
    if (Object.keys(jsonExtracted).filter(k => jsonExtracted[k] !== null).length > 0) {
      return jsonExtracted;
    }
  }
  
  switch (strategyType) {
    case 'parse_json':
      return extractFromNextData(html, extractionMap);
    
    case 'query_selector':
      return extractFromCSSSelectors(html, extractionMap);
    
    case 'llm_extract':
    default:
      // Return empty - will fall back to LLM extraction
      console.log('⚠️ Strategy is llm_extract or unknown, will use LLM for extraction');
      return {};
  }
}

