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
 * Use LLM to intelligently locate and extract all fields from HTML
 */
export async function extractWithLLM(
  html: string,
  listingUrl: string,
  supabase: any,
  openaiKey?: string
): Promise<Record<string, any>> {
  const checklist = await getFieldChecklist(supabase);
  
  // Truncate HTML to avoid token limits (keep first 50k chars - usually enough for main content)
  const htmlSnippet = html.substring(0, 50000);
  
  // Build comprehensive prompt with database schema as checklist
  const fieldsList = checklist
    .sort((a, b) => b.priority - a.priority)
    .map(f => {
      const hints = f.extraction_hints.join(', ');
      return `- ${f.field_name} (${f.db_column}, ${f.data_type}, ${f.is_required ? 'REQUIRED' : 'optional'}): ${f.llm_question}\n  Instructions: ${f.llm_instructions}\n  Look in: ${hints}\n  Examples: ${f.example_values.slice(0, 3).join(', ')}`;
    })
    .join('\n');

  const prompt = `You are extracting vehicle data from a Cars & Bids auction listing HTML.

DATABASE SCHEMA CHECKLIST (extract ALL of these if present):
${fieldsList}

HTML CONTENT (first 50k chars):
${htmlSnippet}

LISTING URL: ${listingUrl}

TASK:
1. Analyze the HTML structure to locate where each field is located
2. Extract ALL fields from the checklist that are present in the HTML
3. For each field, provide:
   - The extracted value
   - Where you found it (CSS selector, element description, or section name)
   - Your confidence level (high/medium/low)

Return a JSON object with this structure:
{
  "extracted_fields": {
    "year": { "value": 1967, "location": "h1.title element", "confidence": "high" },
    "make": { "value": "Chevrolet", "location": "h1.title element", "confidence": "high" },
    "model": { "value": "Corvette Convertible", "location": "h1.title element", "confidence": "high" },
    "vin": { "value": "194677S123456", "location": "specs table, VIN row", "confidence": "medium" },
    "mileage": { "value": 45000, "location": "specs table, Mileage row", "confidence": "high" },
    "description": { "value": "Full description text...", "location": "article.content section", "confidence": "high" },
    "current_bid": { "value": 50000, "location": "auction header, current bid display", "confidence": "high" },
    "structured_sections": { "value": { "dougs_take": "...", "highlights": ["...", "..."], "equipment": ["..."] }, "location": "structured sections in main content", "confidence": "high" }
  },
  "html_structure_analysis": {
    "main_content_selector": "article.main-content or div.listing-content",
    "specs_table_selector": "table.specs or div.specs-grid",
    "auction_header_selector": "div.auction-header or header.auction",
    "image_gallery_selector": "div.gallery or script#__NEXT_DATA__",
    "description_section_selector": "div.description or article.content"
  },
  "missing_fields": ["field1", "field2"],
  "extraction_notes": "Any important notes about the extraction"
}

CRITICAL: Extract EVERYTHING that's present. Don't skip fields just because they're in a different location than expected.`;

  try {
    const apiKey = openaiKey || Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      console.warn('⚠️ No OpenAI API key found, skipping LLM extraction');
      return {};
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting structured data from HTML. You analyze HTML structure and locate data fields intelligently.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 4000,
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
      
      // Convert extracted_fields to flat object for easier merging
      const extracted: Record<string, any> = {};
      if (result.extracted_fields) {
        for (const [fieldName, fieldData] of Object.entries(result.extracted_fields)) {
          const data = fieldData as any;
          extracted[fieldName] = data.value;
          
          // Log extraction for debugging
          console.log(`✅ LLM extracted ${fieldName}: ${JSON.stringify(data.value).substring(0, 100)} (${data.confidence} confidence, found in: ${data.location})`);
        }
      }

      // Log missing fields
      if (result.missing_fields && result.missing_fields.length > 0) {
        console.log(`⚠️ LLM could not find: ${result.missing_fields.join(', ')}`);
      }

      // Log HTML structure analysis for future reference
      if (result.html_structure_analysis) {
        console.log(`📊 HTML Structure Analysis:`, result.html_structure_analysis);
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

