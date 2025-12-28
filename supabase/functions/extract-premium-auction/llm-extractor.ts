/**
 * LLM-based HTML extraction using database schema as checklist
 * Intelligently locates and extracts all required fields from HTML
 */

interface FieldChecklist {
  field_name: string;
  db_table: string;
  db_column: string;
  data_type: string;
  is_required: boolean;
  priority: number;
  llm_question: string;
  llm_instructions: string;
  extraction_hints: string[];
  common_patterns: string[];
  example_values: string[];
}

interface ExtractionResult {
  field_name: string;
  value: any;
  location: string; // Where in HTML it was found
  confidence: 'high' | 'medium' | 'low';
  extraction_method: string;
}

/**
 * Get field checklist from database or use default schema
 */
async function getFieldChecklist(supabase: any): Promise<FieldChecklist[]> {
  try {
    const { data, error } = await supabase
      .from('extraction_field_checklist')
      .select('*')
      .order('priority', { ascending: false });
    
    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (e) {
    console.warn('Could not load field checklist from DB, using default');
  }
  
  // Default checklist based on vehicles table schema
  return [
    {
      field_name: 'year',
      db_table: 'vehicles',
      db_column: 'year',
      data_type: 'integer',
      is_required: true,
      priority: 100,
      llm_question: 'What is the vehicle year?',
      llm_instructions: 'Look for 4-digit year (1885-2025+). Check title, heading, specs section, or URL pattern.',
      extraction_hints: ['check_title', 'check_specs_section', 'check_url_pattern', 'check_structured_data'],
      common_patterns: ['\\b(18|19|20)\\d{2}\\b', '\\b\\d{4}\\b'],
      example_values: ['2023', '1995', '1968']
    },
    {
      field_name: 'make',
      db_table: 'vehicles',
      db_column: 'make',
      data_type: 'text',
      is_required: true,
      priority: 100,
      llm_question: 'What is the vehicle make (manufacturer)?',
      llm_instructions: 'Look for manufacturer name. Normalize: "Chevy" → "Chevrolet", "VW" → "Volkswagen". Check title, specs, or structured data.',
      extraction_hints: ['check_title', 'check_specs_section', 'check_structured_data'],
      common_patterns: ['Chevrolet', 'Ford', 'BMW', 'Mercedes-Benz', 'Porsche'],
      example_values: ['Chevrolet', 'Ford', 'BMW']
    },
    {
      field_name: 'model',
      db_table: 'vehicles',
      db_column: 'model',
      data_type: 'text',
      is_required: true,
      priority: 100,
      llm_question: 'What is the vehicle model?',
      llm_instructions: 'Look for model name after make. May include trim info. Check title, specs section, or structured data.',
      extraction_hints: ['check_title', 'check_specs_section', 'check_structured_data'],
      common_patterns: ['Corvette', 'Mustang', '911', 'M3'],
      example_values: ['Corvette', 'Mustang', '911']
    },
    {
      field_name: 'vin',
      db_table: 'vehicles',
      db_column: 'vin',
      data_type: 'text',
      is_required: false,
      priority: 95,
      llm_question: 'What is the VIN?',
      llm_instructions: 'Look for 17-character VIN. Check specs table, description, or title. Format: alphanumeric (no I, O, Q).',
      extraction_hints: ['check_specs_table', 'check_description', 'check_title'],
      common_patterns: ['[A-HJ-NPR-Z0-9]{17}'],
      example_values: ['1G1YY32G5X5114539']
    },
    {
      field_name: 'mileage',
      db_table: 'vehicles',
      db_column: 'mileage',
      data_type: 'integer',
      is_required: false,
      priority: 90,
      llm_question: 'What is the vehicle mileage/odometer reading?',
      llm_instructions: 'Look for mileage number. May be in specs, description, or title. Format: number with "miles", "mi", or "km".',
      extraction_hints: ['check_specs_table', 'check_description', 'check_title'],
      common_patterns: ['\\d+[,\\d]*\\s*(miles?|mi|km)'],
      example_values: ['45,000 miles', '120000 km']
    },
    {
      field_name: 'color',
      db_table: 'vehicles',
      db_column: 'color',
      data_type: 'text',
      is_required: false,
      priority: 85,
      llm_question: 'What is the exterior color?',
      llm_instructions: 'Look for exterior color. Check specs section, description, or title.',
      extraction_hints: ['check_specs_section', 'check_description'],
      common_patterns: ['Red', 'Blue', 'Black', 'White', 'Silver'],
      example_values: ['Red', 'Navy Blue', 'Jet Black']
    },
    {
      field_name: 'interior_color',
      db_table: 'vehicles',
      db_column: 'interior_color',
      data_type: 'text',
      is_required: false,
      priority: 80,
      llm_question: 'What is the interior color?',
      llm_instructions: 'Look for interior color. Check specs section or description.',
      extraction_hints: ['check_specs_section', 'check_description'],
      common_patterns: ['Black', 'Tan', 'Beige', 'Red'],
      example_values: ['Black', 'Tan Leather']
    },
    {
      field_name: 'transmission',
      db_table: 'vehicles',
      db_column: 'transmission',
      data_type: 'text',
      is_required: false,
      priority: 85,
      llm_question: 'What is the transmission type?',
      llm_instructions: 'Look for transmission: Manual, Automatic, DCT, etc. Check specs section.',
      extraction_hints: ['check_specs_section'],
      common_patterns: ['Manual', 'Automatic', 'DCT', 'CVT'],
      example_values: ['6-Speed Manual', 'Automatic']
    },
    {
      field_name: 'engine_size',
      db_table: 'vehicles',
      db_column: 'engine_size',
      data_type: 'text',
      is_required: false,
      priority: 85,
      llm_question: 'What is the engine size/description?',
      llm_instructions: 'Look for engine: "5.7L V8", "3.0L I6", etc. Check specs section.',
      extraction_hints: ['check_specs_section'],
      common_patterns: ['\\d+\\.\\d+L', 'V\\d+', 'I\\d+'],
      example_values: ['5.7L V8', '3.0L I6']
    },
    {
      field_name: 'drivetrain',
      db_table: 'vehicles',
      db_column: 'drivetrain',
      data_type: 'text',
      is_required: false,
      priority: 80,
      llm_question: 'What is the drivetrain?',
      llm_instructions: 'Look for drivetrain: RWD, AWD, FWD, 4WD. Check specs section.',
      extraction_hints: ['check_specs_section'],
      common_patterns: ['RWD', 'AWD', 'FWD', '4WD'],
      example_values: ['RWD', 'AWD']
    },
    {
      field_name: 'description',
      db_table: 'vehicles',
      db_column: 'description',
      data_type: 'text',
      is_required: false,
      priority: 90,
      llm_question: 'What is the full listing description?',
      llm_instructions: 'Extract ALL text content describing the vehicle. Include condition, history, modifications, etc. Get complete paragraphs.',
      extraction_hints: ['check_description_section', 'check_article_content', 'check_main_content'],
      common_patterns: [],
      example_values: []
    },
    {
      field_name: 'current_bid',
      db_table: 'vehicles',
      db_column: 'current_bid',
      data_type: 'number',
      is_required: false,
      priority: 95,
      llm_question: 'What is the current bid amount?',
      llm_instructions: 'Look for current bid in USD. Check auction header, bid section, or timer area.',
      extraction_hints: ['check_auction_header', 'check_bid_section', 'check_timer_area'],
      common_patterns: ['\\$[\\d,]+'],
      example_values: ['$50,000', '$125,000']
    },
    {
      field_name: 'reserve_met',
      db_table: 'vehicles',
      db_column: 'reserve_met',
      data_type: 'boolean',
      is_required: false,
      priority: 90,
      llm_question: 'Has the reserve been met?',
      llm_instructions: 'Look for "Reserve Met" or "Reserve Not Met" indicator. Check auction status area.',
      extraction_hints: ['check_auction_status', 'check_reserve_indicator'],
      common_patterns: ['Reserve Met', 'Reserve Not Met'],
      example_values: ['true', 'false']
    },
    {
      field_name: 'reserve_price',
      db_table: 'vehicles',
      db_column: 'reserve_price',
      data_type: 'number',
      is_required: false,
      priority: 85,
      llm_question: 'What is the reserve price (if disclosed)?',
      llm_instructions: 'Look for reserve price if seller disclosed it. May be in auction details or description.',
      extraction_hints: ['check_auction_details', 'check_description'],
      common_patterns: ['Reserve: \\$[\\d,]+'],
      example_values: ['$45,000']
    },
    {
      field_name: 'auction_end_date',
      db_table: 'vehicles',
      db_column: 'auction_end_date',
      data_type: 'timestamp',
      is_required: false,
      priority: 95,
      llm_question: 'When does the auction end?',
      llm_instructions: 'Look for auction end date/time. Check timer, auction header, or countdown. Convert to ISO format.',
      extraction_hints: ['check_timer', 'check_auction_header', 'check_countdown'],
      common_patterns: ['\\d{4}-\\d{2}-\\d{2}', '\\d+/\\d+/\\d+'],
      example_values: ['2024-12-30T15:00:00Z']
    },
    {
      field_name: 'location',
      db_table: 'vehicles',
      db_column: 'location',
      data_type: 'text',
      is_required: false,
      priority: 75,
      llm_question: 'Where is the vehicle located?',
      llm_instructions: 'Look for location. Check seller info, description, or auction details.',
      extraction_hints: ['check_seller_info', 'check_description', 'check_auction_details'],
      common_patterns: ['City, State', 'City, Country'],
      example_values: ['Los Angeles, CA', 'New York, NY']
    },
    {
      field_name: 'structured_sections',
      db_table: 'vehicles',
      db_column: 'origin_metadata',
      data_type: 'jsonb',
      is_required: false,
      priority: 85,
      llm_question: 'What structured sections are present (Doug\'s Take, Highlights, Equipment, Modifications, Known Flaws, Service History, etc.)?',
      llm_instructions: 'Extract all structured text sections. Look for headings like "Doug\'s Take", "Highlights", "Equipment", "Modifications", "Known Flaws", "Recent Service History", "Ownership History", "Seller Notes".',
      extraction_hints: ['check_structured_sections', 'check_headings', 'check_list_items'],
      common_patterns: [],
      example_values: []
    }
  ];
}

/**
 * PHASE 1: Use LLM to analyze page structure and create extraction strategy
 * Returns a map of where each field is located (CSS selectors, JSON paths, etc.)
 */
export async function analyzePageStructure(
  html: string,
  listingUrl: string,
  openaiKey?: string
): Promise<{ strategy: Record<string, any>; extraction_map: Record<string, string> }> {
  const htmlSnippet = html.substring(0, 30000); // More HTML for structure analysis
  
  const prompt = `Analyze this Cars & Bids auction page HTML and create an extraction strategy.

Your job is to FIND WHERE the data is located, not extract it yet.

HTML:
${htmlSnippet}

Return JSON with:
{
  "data_locations": {
    "mileage": "CSS selector or JSON path where mileage is found",
    "color": "CSS selector or JSON path where color is found",
    "transmission": "CSS selector or JSON path where transmission is found",
    "engine_size": "CSS selector or JSON path where engine is found",
    "vin": "CSS selector or JSON path where VIN is found"
  },
  "data_format": "html_text | json_embedded | javascript_variable | structured_data",
  "json_paths": ["path.to.data if JSON found"],
  "css_selectors": ["selector if HTML found"],
  "extraction_strategy": "How to best extract: 'parse_json', 'query_selector', 'regex_pattern', or 'llm_extract'"
}

Be specific - give exact selectors or paths.`;

  try {
    // Try Google Gemini first (free tier), fall back to OpenAI
    const googleKey = Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GEMINI_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (googleKey) {
      // Use Google Gemini API (free tier)
      console.log('🔍 Using Google Gemini API for structure analysis...');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${googleKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no code blocks.'
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Google Gemini structure analysis failed: ${response.status} - ${errorText}`);
        // Fall back to OpenAI if available
        if (openaiKey) {
          console.log('🔄 Falling back to OpenAI...');
        } else {
          return { strategy: {}, extraction_map: {} };
        }
      } else {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (content) {
          try {
            const result = JSON.parse(content);
            console.log(`✅ Google Gemini analyzed page structure. Strategy: ${result.extraction_strategy || 'unknown'}`);
            return {
              strategy: result,
              extraction_map: result.data_locations || {}
            };
          } catch (parseError) {
            console.warn(`⚠️ Failed to parse Gemini JSON response:`, parseError);
            console.warn(`Raw response:`, content.substring(0, 500));
            // Fall through to OpenAI if available
          }
        }
      }
    }
    
    // Fall back to OpenAI if Google failed or not available
    const apiKey = openaiKey;
    if (!apiKey) {
      console.warn('⚠️ No Google or OpenAI API key found');
      return { strategy: {}, extraction_map: {} };
    }

    console.log('🔍 Using OpenAI API for structure analysis...');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500,
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      console.warn(`LLM structure analysis failed: ${response.status}`);
      return { strategy: {}, extraction_map: {} };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    if (!content) return { strategy: {}, extraction_map: {} };

    try {
      const result = JSON.parse(content);
      console.log(`✅ LLM analyzed page structure. Strategy: ${result.extraction_strategy || 'unknown'}`);
      console.log(`📋 LLM structure analysis response:`, JSON.stringify(result, null, 2).substring(0, 1000));
      
      const extraction_map = result.data_locations || {};
      if (Object.keys(extraction_map).length === 0) {
        console.warn(`⚠️ LLM structure analysis found no data_locations. Full response:`, JSON.stringify(result, null, 2).substring(0, 500));
      }
      
      return {
        strategy: result,
        extraction_map: extraction_map
      };
    } catch (parseError) {
      console.warn(`⚠️ Failed to parse LLM structure analysis response:`, parseError);
      console.warn(`Raw response:`, content.substring(0, 500));
      return { strategy: {}, extraction_map: {} };
    }
  } catch (error: any) {
    console.warn(`LLM structure analysis error: ${error?.message}`);
    return { strategy: {}, extraction_map: {} };
  }
}

/**
 * PHASE 2: Use LLM to extract data based on the strategy map
 */
export async function extractWithLLM(
  html: string,
  listingUrl: string,
  supabase: any,
  openaiKey?: string,
  extractionMap?: Record<string, string>
): Promise<Record<string, any>> {
  // If we have an extraction map from structure analysis, use it
  // Otherwise fall back to simple extraction
  const htmlSnippet = html.substring(0, 30000);
  
  let prompt: string;
  
  if (extractionMap && Object.keys(extractionMap).length > 0) {
    // Use the extraction map to guide extraction
    const mapInstructions = Object.entries(extractionMap)
      .map(([field, location]) => `- ${field}: Look at ${location}`)
      .join('\n');
    
    prompt = `Extract vehicle data using these specific locations I found:

${mapInstructions}

HTML:
${htmlSnippet}

Extract the values from the locations specified above. Return JSON:
{
  "extracted_fields": {
    "mileage": <number or null>,
    "color": <string or null>,
    "transmission": <string or null>,
    "engine_size": <string or null>,
    "vin": <string or null>
  }
}`;
  } else {
    // Fallback: simple extraction without map
    prompt = `Extract these vehicle fields from the HTML:

- mileage: What is the vehicle mileage/odometer reading?
- color: What is the exterior color?
- transmission: What is the transmission type?
- engine_size: What is the engine size/description?
- vin: What is the VIN (17 characters)?

HTML:
${htmlSnippet}

Return JSON:
{
  "extracted_fields": {
    "mileage": <number or null>,
    "color": <string or null>,
    "transmission": <string or null>,
    "engine_size": <string or null>,
    "vin": <string or null>
  }
}

Extract only fields that are clearly present. Use null for missing fields.`;
  }

  try {
    // Try Google Gemini first (free tier), fall back to OpenAI
    const googleKey = Deno.env.get('GOOGLE_API_KEY') || Deno.env.get('GEMINI_API_KEY');
    const apiKey = openaiKey || Deno.env.get('OPENAI_API_KEY');
    
    if (googleKey) {
      // Use Google Gemini API (free tier)
      console.log('📥 Using Google Gemini API for extraction...');
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${googleKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt + '\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no code blocks.'
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Google Gemini extraction failed: ${response.status} - ${errorText}`);
        // Fall back to OpenAI if available
        if (apiKey) {
          console.log('🔄 Falling back to OpenAI...');
        } else {
          return {};
        }
      } else {
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (content) {
          try {
            const result = JSON.parse(content);
            const extracted: Record<string, any> = {};
            if (result.extracted_fields) {
              for (const [fieldName, fieldData] of Object.entries(result.extracted_fields)) {
                const value = (fieldData as any).value;
                if (value !== null && value !== undefined) {
                  extracted[fieldName] = value;
                }
              }
            }
            const extractedCount = Object.keys(extracted).filter(k => extracted[k] !== null && extracted[k] !== undefined).length;
            if (extractedCount > 0) {
              console.log(`✅ Google Gemini extracted ${extractedCount} fields: ${Object.keys(extracted).filter(k => extracted[k] !== null && extracted[k] !== undefined).join(', ')}`);
            }
            return extracted;
          } catch (parseError) {
            console.warn(`⚠️ Failed to parse Gemini JSON response:`, parseError);
            // Try to extract JSON from markdown
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const result = JSON.parse(jsonMatch[0]);
                const extracted: Record<string, any> = {};
                if (result.extracted_fields) {
                  for (const [fieldName, fieldData] of Object.entries(result.extracted_fields)) {
                    const value = (fieldData as any).value;
                    if (value !== null && value !== undefined) {
                      extracted[fieldName] = value;
                    }
                  }
                }
                return extracted;
              } catch {
                // Failed to parse
              }
            }
          }
        }
        // If we got here, Gemini didn't work, fall through to OpenAI
      }
    }
    
    // Fall back to OpenAI if Google failed or not available
    if (!apiKey) {
      console.warn('⚠️ No Google or OpenAI API key found, skipping LLM extraction');
      return {};
    }

    console.log('📥 Using OpenAI API for extraction...');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Much cheaper than gpt-4o, still very capable
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1000, // Reduced from 4000 - simple extractions don't need that much
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`LLM extraction failed: ${response.status} - ${errorText}`);
      return {};
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;
    
    if (!content) {
      console.warn('LLM returned empty response');
      return {};
    }

    try {
      const result = JSON.parse(content);
      
      // Convert extracted_fields to flat object (simplified - no nested structure)
      const extracted: Record<string, any> = {};
      if (result.extracted_fields) {
        for (const [fieldName, fieldValue] of Object.entries(result.extracted_fields)) {
          // Handle both simple values and nested {value, location, confidence} objects
          if (typeof fieldValue === 'object' && fieldValue !== null && 'value' in fieldValue) {
            extracted[fieldName] = (fieldValue as any).value;
          } else {
            extracted[fieldName] = fieldValue;
          }
        }
        
        const extractedCount = Object.keys(extracted).filter(k => extracted[k] !== null && extracted[k] !== undefined).length;
        if (extractedCount > 0) {
          console.log(`✅ LLM extracted ${extractedCount} fields: ${Object.keys(extracted).filter(k => extracted[k] !== null && extracted[k] !== undefined).join(', ')}`);
          console.log(`📋 LLM extracted values:`, JSON.stringify(extracted, null, 2));
        } else {
          console.log(`⚠️ LLM extraction returned ${Object.keys(extracted).length} fields but all are null/empty`);
          console.log(`📋 LLM raw response:`, JSON.stringify(result, null, 2).substring(0, 1000));
        }
      }

      return extracted;
    } catch (parseError) {
      console.warn('Failed to parse LLM JSON response:', parseError);
      // Try to extract JSON from response if it's wrapped in markdown
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const result = JSON.parse(jsonMatch[0]);
          const extracted: Record<string, any> = {};
          if (result.extracted_fields) {
            for (const [fieldName, fieldData] of Object.entries(result.extracted_fields)) {
              extracted[fieldName] = (fieldData as any).value;
            }
          }
          return extracted;
        } catch {
          console.warn('Failed to parse extracted JSON');
        }
      }
      return {};
    }
  } catch (error: any) {
    console.warn(`LLM extraction error: ${error?.message || String(error)}`);
    return {};
  }
}

