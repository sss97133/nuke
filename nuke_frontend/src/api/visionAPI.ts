// Real AI Vision API Integration
// This will call actual AI services for vehicle analysis

export interface VehicleDetectionResult {
  hasVehicle: boolean;
  confidence: number;
  vehicleType?: 'car' | 'truck' | 'suv' | 'motorcycle' | 'van';
  reasoning?: string;
}

export interface VehicleAnalysisResult {
  identification?: {
    make?: string;
    make_confidence?: number;
    model?: string;
    model_confidence?: number;
    year?: number;
    year_confidence?: number;
    generation?: string;
    generation_confidence?: number;
    trim?: string;
    trim_confidence?: number;
  };
  condition?: {
    paint?: string;
    paint_confidence?: number;
    body?: string;
    body_confidence?: number;
    overall?: string;
    overall_confidence?: number;
  };
  features?: string[];
  features_confidence?: number;
  color?: string;
  color_confidence?: number;
  market_context?: {
    estimated_value_range?: string;
    rarity_notes?: string;
    authenticity_confidence?: number;
  };
  analysis_quality?: {
    image_clarity?: number;
    angle_adequacy?: number;
    lighting_quality?: number;
  };
  limitations?: string[];
  recommendations?: string[];
  // Legacy fields for backward compatibility
  make?: string;
  model?: string;
  year?: number;
  confidence?: number;
}

export interface VINDetectionResult {
  hasVIN: boolean;
  vin?: string;
  confidence: number;
  location?: { x: number; y: number; width: number; height: number };
}

// Extraction result for vehicle title documents
export interface TitleExtractionResult {
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  title_number?: string;
  state?: string;
  issue_date?: string;
  owner_names?: string[];
  owner_address?: string;
  odometer?: number;
  // Some titles specify an odometer status instead of a numeric value
  // e.g. "Actual", "Exempt", "Not Actual", etc.
  odometer_status?: string;
  raw_text?: string;
  reasoning?: string;
  confidences?: { [key: string]: number };
}

export interface VehicleClusteringResult {
  clusterId: string;
  confidence: number;
  reasoning: string;
}

class VisionAPI {
  private apiKey: string;
  private baseURL: string;

  constructor() {
    // In production, these would come from environment variables
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY || import.meta.env.REACT_APP_OPENAI_API_KEY || '';
    this.baseURL = 'https://api.openai.com/v1';
  }

  // Step 1: Detect if image contains a vehicle
  async detectVehicle(base64Image: string): Promise<VehicleDetectionResult> {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Analyze this image and determine if it contains a vehicle (car, truck, SUV, motorcycle, van, etc.). Respond with JSON format: {"hasVehicle": boolean, "confidence": number 0-100, "vehicleType": string, "reasoning": string}'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 300
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url
        });
        throw new Error(`Vision API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      let content = data.choices[0].message.content;
      
      // Remove markdown code blocks if present
      if (content.includes('```json')) {
        content = content.replace(/```json\s*/, '').replace(/\s*```/, '');
      } else if (content.includes('```')) {
        content = content.replace(/```\s*/, '').replace(/\s*```/, '');
      }
      
      const result = JSON.parse(content.trim());
      
      return {
        hasVehicle: result.hasVehicle,
        confidence: result.confidence,
        vehicleType: result.vehicleType,
        reasoning: result.reasoning
      };

    } catch (error) {
      console.error('Vehicle detection failed:', error);
      return {
        hasVehicle: false,
        confidence: 0,
        reasoning: 'API call failed'
      };
    }
  }

  // Step 2: Analyze vehicle details
  async analyzeVehicleWithContext(base64Image: string, userContext: string = ''): Promise<VehicleAnalysisResult> {
    try {
      const contextInstruction = userContext.trim() 
        ? `\n\nIMPORTANT USER CONTEXT: ${userContext}\n\nUse this context to cross-reference and improve your analysis accuracy. If this is a Bring a Trailer link, reference the listing details for verification.`
        : '';

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `EXTRACT VEHICLE INDICATORS - CAPTURE ALL RELEVANT MARKERS.

You are a vehicle data extraction system. Extract specific indicators and markers that define this vehicle's characteristics, condition, and features.${contextInstruction}

FIRST: IDENTIFY VEHICLE TYPE, THEN EXTRACT ALL RELEVANT INDICATORS:

1. BASIC IDENTIFICATION:
   - Make, model, year, body style, trim
   - Generation/chassis code if determinable
   - Special editions or packages

2. CONDITION INDICATORS:
   - Rust severity and location (frame, body panels, etc.)
   - Paint quality (original, repaint, clear coat condition)
   - Body panel alignment and gaps
   - Chrome/trim condition
   - Glass condition (original vs replacement)
   - Interior wear level

3. ORIGINALITY MARKERS:
   - Stock vs modified appearance
   - Original wheels vs aftermarket
   - Engine bay modifications visible
   - Suspension modifications
   - Exhaust modifications
   - Interior modifications

4. FEATURE INDICATORS (VARIES BY VEHICLE TYPE):
   For Classic Trucks (Squarebody, etc.):
   - Bed condition and type
   - 4WD vs 2WD indicators
   - Engine type visible (small block, big block, diesel)
   - Cab configuration (regular, extended, crew)
   
   For Sports Cars:
   - Transmission type indicators
   - Performance package visual cues
   - Aero components
   - Brake upgrades visible
   
   For Classic Cars:
   - Numbers matching indicators
   - Rare options visible
   - Documentation visible in photos
   - Concours-level details

5. DAMAGE INDICATORS:
   - Accident damage indicators
   - Poor quality repairs
   - Rust-through areas
   - Mismatched panels
   - Cheap modifications
   - Missing original components

6. RARITY MARKERS:
   - Special badges or trim
   - Unusual color combinations
   - Limited production features
   - Date codes or build tags visible

RESPOND WITH STRUCTURED JSON - NO DESCRIPTIONS, ONLY DATA:
{
  "make": "exact_brand_name",
  "model": "exact_model_name", 
  "year": year_number_or_null,
  "body_style": "specific_body_type",
  "trim": "trim_level_or_null",
  "generation": "chassis_code_or_generation",
  "color": "specific_color_name",
  "doors": number_or_null,
  "engine_type": "engine_info_or_null",
  
  "condition_indicators": {
    "rust_severity": 0_to_10_or_null,
    "rust_locations": ["specific_rust_areas"],
    "paint_quality": 0_to_10_or_null,
    "paint_type": "original/repaint/primer/etc",
    "body_alignment": 0_to_10_or_null,
    "chrome_condition": 0_to_10_or_null,
    "glass_condition": 0_to_10_or_null,
    "interior_wear": 0_to_10_or_null
  },
  
  "originality_markers": {
    "stock_appearance": true_or_false,
    "original_wheels": true_or_false_or_null,
    "engine_modifications": ["visible_engine_mods"],
    "suspension_mods": ["visible_suspension_changes"],
    "exhaust_mods": ["visible_exhaust_changes"],
    "interior_mods": ["visible_interior_changes"]
  },
  
  "feature_indicators": {
    "drivetrain": "2WD/4WD/AWD/etc",
    "transmission": "manual/automatic/etc",
    "special_packages": ["performance_packages_visible"],
    "rare_options": ["unusual_or_rare_features"],
    "bed_type": "shortbed/longbed/stepside/etc",
    "cab_config": "regular/extended/crew/etc"
  },
  
  "damage_indicators": {
    "accident_damage": ["signs_of_accident_damage"],
    "poor_repairs": ["evidence_of_poor_quality_work"],
    "rust_through": ["areas_with_rust_holes"],
    "mismatched_panels": ["panels_that_dont_match"],
    "cheap_mods": ["low_quality_modifications"]
  },
  
  "rarity_markers": {
    "special_badges": ["unique_badges_or_trim"],
    "unusual_colors": ["rare_color_combinations"],
    "limited_features": ["limited_production_items"],
    "build_tags": ["visible_date_codes_or_tags"]
  },
  
  "confidence": {
    "make": 0_to_100,
    "model": 0_to_100,
    "year": 0_to_100,
    "overall": 0_to_100
  }
}`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url
        });
        throw new Error(`Vision API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      let content = data.choices[0].message.content;
      
      // Remove markdown code blocks if present
      if (content.includes('```json')) {
        content = content.replace(/```json\s*/, '').replace(/\s*```/, '');
      } else if (content.includes('```')) {
        content = content.replace(/```\s*/, '').replace(/\s*```/, '');
      }
      
      const result = JSON.parse(content.trim());
      
      // Return only properties that exist in VehicleAnalysisResult interface
      return {
        make: result.make,
        model: result.model,
        year: result.year,
        color: result.color,
        confidence: result.confidence?.overall || 0
      };
    } catch (error: any) {
      console.error('Vehicle analysis failed:', error);
      return {
        confidence: 0
      };
    }
  }

  async analyzeVehicle(base64Image: string): Promise<VehicleAnalysisResult> {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are a professional automotive appraiser with access to reference-quality data from sources like Classics.com, Bring a Trailer, Barrett-Jackson, and other authoritative automotive databases. Analyze this vehicle image with the precision of a certified appraiser.

FOLLOW THIS SYSTEMATIC APPROACH:

1. IDENTIFICATION (Use your knowledge of automotive history, design evolution, and market data):
   - Examine body style, proportions, design language evolution
   - Identify badges, emblems, grille patterns, and manufacturer signatures
   - Analyze headlight/taillight configurations and their production years
   - Study wheel designs, brake caliper visibility, tire specifications
   - Note distinctive styling elements and their model year indicators
   - Cross-reference with known production changes and special editions

2. CONDITION ASSESSMENT (Rate each element with specific confidence):
   - Paint condition: scratches, dents, rust, oxidation, color matching
   - Body panel alignment, gaps, and factory tolerances
   - Tire condition, wear patterns, brand/model if visible
   - Glass condition: chips, cracks, tinting, replacement indicators
   - Trim, molding, and weather stripping condition
   - Overall maintenance level and care indicators

3. FEATURES & EQUIPMENT IDENTIFICATION:
   - Technology packages (sensors, cameras, radar systems)
   - Lighting systems (LED, HID, halogen, adaptive features)
   - Wheel and brake specifications
   - Exterior accessories, aero packages, performance indicators
   - Safety features and driver assistance systems
   - Special edition or option package indicators

4. MARKET CONTEXT & ACCURACY:
   - Reference similar vehicles from Classics.com, BaT, and auction data
   - Consider production numbers, rarity, and market significance
   - Note any discrepancies or unusual combinations
   - Assess authenticity indicators and potential modifications

Respond with JSON including INDIVIDUAL CONFIDENCE SCORES for each field:
{
  "identification": {
    "make": "Brand name",
    "make_confidence": confidence_0_to_100,
    "model": "Specific model name",
    "model_confidence": confidence_0_to_100,
    "year": estimated_year_number,
    "year_confidence": confidence_0_to_100,
    "generation": "Model generation/chassis code",
    "generation_confidence": confidence_0_to_100,
    "trim": "Trim level/package",
    "trim_confidence": confidence_0_to_100
  },
  "condition": {
    "paint": "Paint condition assessment",
    "paint_confidence": confidence_0_to_100,
    "body": "Body condition assessment",
    "body_confidence": confidence_0_to_100,
    "overall": "Overall condition rating",
    "overall_confidence": confidence_0_to_100
  },
  "features": ["array of specific visible features with high confidence"],
  "features_confidence": confidence_0_to_100,
  "color": "Specific color name/code if identifiable",
  "color_confidence": confidence_0_to_100,
  "market_context": {
    "estimated_value_range": "Based on condition and market data",
    "rarity_notes": "Production numbers or special significance",
    "authenticity_confidence": confidence_0_to_100
  },
  "analysis_quality": {
    "image_clarity": confidence_0_to_100,
    "angle_adequacy": confidence_0_to_100,
    "lighting_quality": confidence_0_to_100
  },
  "limitations": ["specific elements that cannot be determined"],
  "recommendations": ["specific additional photos needed for complete assessment"]
}`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 500
        })
      });

      const data = await response.json();
      let content = data.choices[0].message.content;
      
      // Remove markdown code blocks if present
      if (content.includes('```json')) {
        content = content.replace(/```json\s*/, '').replace(/\s*```/, '');
      } else if (content.includes('```')) {
        content = content.replace(/```\s*/, '').replace(/\s*```/, '');
      }
      
      const result = JSON.parse(content.trim());
      
      return {
        identification: result.identification,
        condition: result.condition,
        features: result.features || [],
        features_confidence: result.features_confidence,
        color: result.color,
        color_confidence: result.color_confidence,
        market_context: result.market_context,
        analysis_quality: result.analysis_quality,
        limitations: result.limitations || [],
        recommendations: result.recommendations || [],
        // Legacy fields for backward compatibility
        make: result.identification?.make,
        model: result.identification?.model,
        year: result.identification?.year,
        confidence: result.analysis_quality?.image_clarity || 0
      };

    } catch (error) {
      console.error('Vehicle analysis failed:', error);
      return {
        confidence: 0,
        features: []
      };
    }
  }

  // Step 2b: Extract structured fields from a vehicle title document image
  async extractTitleFields(base64Image: string): Promise<TitleExtractionResult> {
    try {
      if (!this.apiKey) {
        throw new Error('OpenAI API key not configured');
      }

      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are an OCR+extraction system for US vehicle titles. Read the document and extract structured fields. Respond in pure JSON ONLY with keys: {
  "vin": string_or_null,
  "year": number_or_null,
  "make": string_or_null,
  "model": string_or_null,
  "title_number": string_or_null,
  "state": string_or_null,
  "issue_date": iso_date_string_or_null,
  "owner_names": [array_of_strings],
  "owner_address": string_or_null,
  "odometer": number_or_null,
  "odometer_status": string_or_null,  // e.g. "Actual", "Exempt", "Not Actual"
  "raw_text": short_raw_text_snippet,
  "reasoning": short_reasoning,
  "confidences": { "vin": 0-100, "year": 0-100, "make": 0-100, "model": 0-100 }
}`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 500
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenAI API Error (title extract):', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: response.url
        });
        throw new Error(`Vision API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      let content = data.choices[0].message.content as string;

      // Strip code fences
      if (content.includes('```json')) {
        content = content.replace(/```json\s*/, '').replace(/\s*```/, '');
      } else if (content.includes('```')) {
        content = content.replace(/```\s*/, '').replace(/\s*```/, '');
      }

      const parsed = JSON.parse(content.trim());
      const result: TitleExtractionResult = {
        vin: parsed.vin || undefined,
        year: parsed.year || undefined,
        make: parsed.make || undefined,
        model: parsed.model || undefined,
        title_number: parsed.title_number || undefined,
        state: parsed.state || undefined,
        issue_date: parsed.issue_date || undefined,
        owner_names: parsed.owner_names || undefined,
        owner_address: parsed.owner_address || undefined,
        odometer: parsed.odometer || undefined,
        odometer_status: parsed.odometer_status || undefined,
        raw_text: parsed.raw_text || undefined,
        reasoning: parsed.reasoning || undefined,
        confidences: parsed.confidences || {}
      };
      return result;
    } catch (error) {
      console.error('Title extraction failed:', error);
      return {};
    }
  }

  // Step 3: Detect VIN in image
  async detectVIN(base64Image: string): Promise<VINDetectionResult> {
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Look for a VIN (Vehicle Identification Number) in this image. VINs are 17-character alphanumeric codes. Respond with JSON: {"hasVIN": boolean, "vin": string, "confidence": number 0-100}'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          max_tokens: 200
        })
      });

      const data = await response.json();
      let content = data.choices[0].message.content;
      
      // Remove markdown code blocks if present
      if (content.includes('```json')) {
        content = content.replace(/```json\s*/, '').replace(/\s*```/, '');
      } else if (content.includes('```')) {
        content = content.replace(/```\s*/, '').replace(/\s*```/, '');
      }
      
      const result = JSON.parse(content.trim());
      
      return {
        hasVIN: result.hasVIN,
        vin: result.vin,
        confidence: result.confidence
      };

    } catch (error) {
      console.error('VIN detection failed:', error);
      return {
        hasVIN: false,
        confidence: 0
      };
    }
  }

  // Step 4: Cluster photos by vehicle similarity
  async clusterVehiclePhotos(photos: { id: string; base64: string }[]): Promise<Map<string, VehicleClusteringResult>> {
    // This is complex - would need to compare each photo against others
    // For now, we'll implement a simpler approach using individual analysis
    // and grouping by similar characteristics
    
    const results = new Map<string, VehicleClusteringResult>();
    const vehicleGroups: { [key: string]: string[] } = {};
    
    for (const photo of photos) {
      try {
        const analysis = await this.analyzeVehicle(photo.base64);
        
        // Create a signature for this vehicle
        const signature = `${analysis.make}-${analysis.model}-${analysis.year}-${analysis.color}`.toLowerCase();
        
        if (!vehicleGroups[signature]) {
          vehicleGroups[signature] = [];
        }
        
        vehicleGroups[signature].push(photo.id);
        
        results.set(photo.id, {
          clusterId: signature,
          confidence: analysis.confidence || 0,
          reasoning: `Grouped with ${analysis.make} ${analysis.model} ${analysis.year} in ${analysis.color}`
        });
        
      } catch (error) {
        console.error(`Clustering failed for photo ${photo.id}:`, error);
        results.set(photo.id, {
          clusterId: 'unknown',
          confidence: 0,
          reasoning: 'Analysis failed'
        });
      }
    }
    
    return results;
  }
}

export const visionAPI = new VisionAPI();
