import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SourcePreparationRequest {
  sourceUrl: string;
  sourceType: 'auction' | 'marketplace' | 'dealer' | 'supplier';
  testUrls?: string[];
}

interface ExtractionSchema {
  type: 'object';
  properties: {
    [fieldName: string]: {
      type: 'string' | 'number' | 'boolean' | 'array';
      description: string;
      required?: boolean;
      validation?: {
        min?: number;
        max?: number;
        pattern?: string;
        enum?: string[];
      };
    };
  };
  required: string[];
}

// FIRECRAWL EXTRACTION SCHEMAS by source type
const EXTRACTION_SCHEMAS = {
  auction: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Vehicle title or listing name'
      },
      year: {
        type: 'number',
        description: 'Vehicle year (4 digit number)',
        validation: { min: 1900, max: new Date().getFullYear() + 2 }
      },
      make: {
        type: 'string',
        description: 'Vehicle manufacturer (Ford, Chevrolet, BMW, etc)'
      },
      model: {
        type: 'string',
        description: 'Vehicle model name'
      },
      vin: {
        type: 'string',
        description: 'Vehicle Identification Number (17 characters)',
        validation: { pattern: '^[A-HJ-NPR-Z0-9]{17}$' }
      },
      mileage: {
        type: 'number',
        description: 'Vehicle mileage/odometer reading'
      },
      engine: {
        type: 'string',
        description: 'Engine description or specifications'
      },
      transmission: {
        type: 'string',
        description: 'Transmission type (manual, automatic, etc)'
      },
      current_bid: {
        type: 'number',
        description: 'Current highest bid amount in dollars'
      },
      reserve_met: {
        type: 'boolean',
        description: 'Whether the reserve price has been met'
      },
      bid_count: {
        type: 'number',
        description: 'Total number of bids placed'
      },
      end_date: {
        type: 'string',
        description: 'Auction end date and time'
      },
      seller: {
        type: 'string',
        description: 'Seller username or name'
      },
      location: {
        type: 'string',
        description: 'Vehicle location (city, state)'
      },
      description: {
        type: 'string',
        description: 'Full vehicle description or listing text'
      },
      images: {
        type: 'array',
        description: 'Array of image URLs for the vehicle'
      }
    },
    required: ['title', 'year', 'make', 'model']
  },

  dealer: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Vehicle title or listing name'
      },
      year: {
        type: 'number',
        description: 'Vehicle year'
      },
      make: {
        type: 'string',
        description: 'Vehicle manufacturer'
      },
      model: {
        type: 'string',
        description: 'Vehicle model'
      },
      trim: {
        type: 'string',
        description: 'Vehicle trim level'
      },
      vin: {
        type: 'string',
        description: 'Vehicle Identification Number'
      },
      mileage: {
        type: 'number',
        description: 'Vehicle mileage'
      },
      price: {
        type: 'number',
        description: 'Asking price in dollars'
      },
      dealer_name: {
        type: 'string',
        description: 'Dealership name'
      },
      stock_number: {
        type: 'string',
        description: 'Dealer stock number'
      },
      exterior_color: {
        type: 'string',
        description: 'Vehicle exterior color'
      },
      interior_color: {
        type: 'string',
        description: 'Vehicle interior color'
      },
      fuel_type: {
        type: 'string',
        description: 'Fuel type (gasoline, diesel, electric, hybrid)'
      },
      mpg_city: {
        type: 'number',
        description: 'City fuel economy (MPG)'
      },
      mpg_highway: {
        type: 'number',
        description: 'Highway fuel economy (MPG)'
      },
      images: {
        type: 'array',
        description: 'Array of image URLs'
      }
    },
    required: ['year', 'make', 'model', 'price']
  }
};

async function testSourceExtraction(url: string, sourceType: string, firecrawlKey: string) {
  console.log(`🧪 Testing extraction for ${sourceType} source: ${url}`);

  const schema = EXTRACTION_SCHEMAS[sourceType as keyof typeof EXTRACTION_SCHEMAS];

  if (!schema) {
    throw new Error(`No extraction schema for source type: ${sourceType}`);
  }

  try {
    // Use Firecrawl with structured extraction
    const response = await fetch('https://api.firecrawl.dev/v0/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        extractorOptions: {
          mode: 'llm-extraction',
          extractionSchema: schema
        },
        pageOptions: {
          onlyMainContent: true,
          includeHtml: false
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Firecrawl API error: ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.data?.extract) {
      throw new Error('Extraction failed or returned no data');
    }

    return {
      success: true,
      extractedData: result.data.extract,
      metadata: result.data.metadata || {}
    };

  } catch (error) {
    console.error('Extraction test failed:', error);
    return {
      success: false,
      error: error.message,
      extractedData: null
    };
  }
}

function validateExtractedData(data: any, schema: ExtractionSchema) {
  const validation = {
    valid: true,
    errors: [] as string[],
    confidence: 1.0,
    fieldScores: {} as Record<string, number>
  };

  // Check required fields
  for (const requiredField of schema.required) {
    if (!data[requiredField] || data[requiredField] === '') {
      validation.valid = false;
      validation.errors.push(`Missing required field: ${requiredField}`);
      validation.fieldScores[requiredField] = 0;
    } else {
      validation.fieldScores[requiredField] = 1;
    }
  }

  // Validate field types and constraints
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
    const value = data[fieldName];
    if (value == null) continue;

    let fieldValid = true;

    // Type validation
    if (fieldSchema.type === 'number' && typeof value !== 'number') {
      fieldValid = false;
      validation.errors.push(`Field ${fieldName} should be a number`);
    }

    // Constraint validation
    if (fieldSchema.validation) {
      const constraints = fieldSchema.validation;

      if (constraints.min && value < constraints.min) {
        fieldValid = false;
        validation.errors.push(`Field ${fieldName} below minimum ${constraints.min}`);
      }

      if (constraints.max && value > constraints.max) {
        fieldValid = false;
        validation.errors.push(`Field ${fieldName} above maximum ${constraints.max}`);
      }

      if (constraints.pattern && !new RegExp(constraints.pattern).test(value)) {
        fieldValid = false;
        validation.errors.push(`Field ${fieldName} doesn't match pattern`);
      }
    }

    validation.fieldScores[fieldName] = fieldValid ? 1 : 0;
  }

  // Calculate overall confidence
  const scores = Object.values(validation.fieldScores);
  validation.confidence = scores.length > 0 ? scores.reduce((a, b) => a + b) / scores.length : 0;

  if (validation.errors.length > 0) {
    validation.valid = false;
  }

  return validation;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceUrl, sourceType, testUrls = [] }: SourcePreparationRequest = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')!;

    if (!firecrawlKey || firecrawlKey === 'fc-your-api-key-here') {
      throw new Error('Firecrawl API key not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`🔧 Preparing source: ${sourceUrl}`);
    console.log(`📋 Source type: ${sourceType}`);

    // Test extraction on main URL and test URLs
    const urlsToTest = [sourceUrl, ...testUrls];
    const testResults = [];

    for (const testUrl of urlsToTest) {
      const result = await testSourceExtraction(testUrl, sourceType, firecrawlKey);

      if (result.success) {
        const schema = EXTRACTION_SCHEMAS[sourceType as keyof typeof EXTRACTION_SCHEMAS];
        const validation = validateExtractedData(result.extractedData, schema);

        testResults.push({
          url: testUrl,
          success: true,
          extractedData: result.extractedData,
          validation,
          confidence: validation.confidence
        });

        console.log(`✅ ${testUrl}: ${(validation.confidence * 100).toFixed(1)}% confidence`);
      } else {
        testResults.push({
          url: testUrl,
          success: false,
          error: result.error,
          confidence: 0
        });

        console.log(`❌ ${testUrl}: ${result.error}`);
      }
    }

    // Calculate overall source readiness
    const successfulTests = testResults.filter(r => r.success);
    const avgConfidence = successfulTests.length > 0
      ? successfulTests.reduce((acc, r) => acc + r.confidence, 0) / successfulTests.length
      : 0;

    const sourceReadiness = {
      ready: avgConfidence >= 0.7, // 70% confidence threshold
      confidence: avgConfidence,
      successRate: successfulTests.length / testResults.length,
      extractionSchema: EXTRACTION_SCHEMAS[sourceType as keyof typeof EXTRACTION_SCHEMAS],
      testResults,
      preparedAt: new Date().toISOString()
    };

    // Store source preparation results
    const { error: dbError } = await supabase
      .from('source_preparations')
      .upsert({
        source_url: sourceUrl,
        source_type: sourceType,
        readiness: sourceReadiness,
        extraction_schema: sourceReadiness.extractionSchema,
        confidence: avgConfidence,
        status: sourceReadiness.ready ? 'ready' : 'needs_improvement',
        created_at: new Date().toISOString()
      });

    if (dbError) {
      console.error('Failed to store preparation results:', dbError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sourceReadiness,
        message: sourceReadiness.ready
          ? `Source ready for extraction with ${(avgConfidence * 100).toFixed(1)}% confidence`
          : `Source needs improvement - only ${(avgConfidence * 100).toFixed(1)}% confidence`
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      }
    );

  } catch (error) {
    console.error('Source preparation failed:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      }
    );
  }
});