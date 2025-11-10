import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * AUTO-FILL VEHICLE PROFILE FROM SPID SHEET
 * 
 * SPID sheet is 100% truth of origin - use as foundation to auto-fill:
 * - Year (from VIN)
 * - Make (Chevrolet/GMC/etc)
 * - Model (C10, K10, etc from model code)
 * - Trim (Cheyenne, Scottsdale, etc)
 * - Engine (from RPO code like LB9)
 * - Transmission (from RPO code like MX0, M40, etc)
 * - Axle ratio (from RPO code like GU4)
 * - All factory options (from RPO codes)
 * - Paint codes
 * 
 * If engine/colors changed later, that's fine - but SPID is the baseline truth.
 */

interface SPIDData {
  vin: string | null;
  model_code: string | null;
  build_date: string | null;
  paint_code_exterior: string | null;
  paint_code_interior: string | null;
  rpo_codes: string[];
}

// RPO Code Database (GM Regular Production Options)
const RPO_DATABASE: Record<string, { name: string; category: string }> = {
  // Engines
  'LB9': { name: '5.7L V8 (350 ci)', category: 'engine' },
  'L31': { name: '5.7L V8 Vortec', category: 'engine' },
  'LS1': { name: '5.7L V8 LS1', category: 'engine' },
  'LT1': { name: '5.7L V8 LT1', category: 'engine' },
  'LQ4': { name: '6.0L V8', category: 'engine' },
  
  // Transmissions
  'MX0': { name: '3-Speed Manual', category: 'transmission' },
  'M40': { name: '3-Speed Auto (TH350)', category: 'transmission' },
  'M38': { name: '4-Speed Manual', category: 'transmission' },
  'MD8': { name: '4-Speed Auto (700R4)', category: 'transmission' },
  
  // Axle Ratios
  'GU4': { name: '3.08:1 Rear Axle', category: 'axle' },
  'GU5': { name: '3.42:1 Rear Axle', category: 'axle' },
  'GU6': { name: '3.73:1 Rear Axle', category: 'axle' },
  'GT4': { name: '4.10:1 Rear Axle', category: 'axle' },
  
  // Differential
  'G80': { name: 'Positraction (Locking Differential)', category: 'differential' },
  
  // Suspension
  'ZQ8': { name: 'Sport Suspension Package', category: 'suspension' },
  'F60': { name: 'Heavy Duty Front Springs', category: 'suspension' },
  'G51': { name: 'Heavy Duty Rear Springs', category: 'suspension' },
  
  // Comfort/Convenience
  'C60': { name: 'Air Conditioning', category: 'comfort' },
  'N33': { name: 'Tilt Steering Wheel', category: 'comfort' },
  'N40': { name: 'Power Steering', category: 'comfort' },
  'A01': { name: 'Tinted Glass', category: 'comfort' },
  'U69': { name: 'AM/FM Radio', category: 'comfort' },
  
  // Brakes
  'J50': { name: 'Power Brakes', category: 'brakes' },
  'JL4': { name: '4-Wheel Disc Brakes', category: 'brakes' },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vehicleId, spidData } = await req.json() as { 
      vehicleId: string; 
      spidData: SPIDData 
    };

    console.log(`Auto-filling vehicle ${vehicleId} from SPID sheet`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Decode VIN to get year
    let year: number | null = null;
    if (spidData.vin) {
      // Pre-1981 GM VINs: position 6 is year (0-9 = 1970-1979)
      // Post-1981 VINs: position 10 is year
      if (spidData.vin.length === 13) {
        // Pre-1981 format
        const yearDigit = parseInt(spidData.vin[5]);
        year = 1970 + yearDigit;
      } else if (spidData.vin.length === 17) {
        // Post-1981 format
        const yearChar = spidData.vin[9];
        const yearMap: Record<string, number> = {
          'A': 1980, 'B': 1981, 'C': 1982, 'D': 1983, 'E': 1984,
          'F': 1985, 'G': 1986, 'H': 1987, 'J': 1988, 'K': 1989,
          'L': 1990, 'M': 1991, 'N': 1992, 'P': 1993, 'R': 1994,
          'S': 1995, 'T': 1996, 'V': 1997, 'W': 1998, 'X': 1999,
          'Y': 2000, '1': 2001, '2': 2002, '3': 2003, '4': 2004,
        };
        year = yearMap[yearChar];
      }
    }

    // Decode model from VIN
    let model = 'C10'; // Default
    if (spidData.vin && spidData.vin.length >= 4) {
      const modelCode = spidData.vin.substring(2, 4);
      if (modelCode === '14') model = 'C10'; // 117" wheelbase
      if (modelCode === '15') model = 'C15'; // 131" wheelbase
      if (modelCode === '24') model = 'C20'; // 3/4 ton
      if (modelCode === '34') model = 'C30'; // 1 ton
    }

    // Extract engine from RPO codes
    let engine = null;
    let transmission = null;
    let axleRatio = null;
    let hasPosi = false;
    let suspension = null;
    const options: string[] = [];

    for (const rpo of spidData.rpo_codes) {
      const spec = RPO_DATABASE[rpo];
      if (!spec) continue;

      if (spec.category === 'engine') engine = spec.name;
      if (spec.category === 'transmission') transmission = spec.name;
      if (spec.category === 'axle') axleRatio = spec.name;
      if (spec.category === 'differential') hasPosi = true;
      if (spec.category === 'suspension') suspension = spec.name;
      
      options.push(`${rpo}: ${spec.name}`);
    }

    // Build update object
    const updates: any = {
      make: 'Chevrolet', // SPID sheets are GM only
      model: model,
      updated_at: new Date().toISOString(),
    };

    if (year) updates.year = year;
    if (spidData.vin) updates.vin = spidData.vin;
    if (engine) {
      updates.engine_size = engine.split('(')[0].trim();
      updates.displacement = engine.includes('(') ? engine.split('(')[1].replace(')', '').trim() : null;
    }
    if (transmission) updates.transmission = transmission;
    if (spidData.paint_code_exterior) updates.paint_code = spidData.paint_code_exterior;
    if (axleRatio || hasPosi) {
      updates.drivetrain = '2WD'; // C-series is 2WD, K-series is 4WD
    }

    // Update vehicle
    const { data: vehicle, error: updateError } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', vehicleId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Add data validations for each field
    const validations = [];
    const imageUrl = `https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-data/vehicles/${vehicleId}/spid-sheet.jpg`;

    if (year) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'year',
        field_value: year.toString(),
        validation_source: 'title_document', // SPID sheet = title-level authority
        confidence_score: 100,
        source_url: imageUrl,
        notes: `Year decoded from VIN position 6. Pre-1981 13-character VIN format.`
      });
    }

    if (engine) {
      validations.push({
        entity_type: 'vehicle',
        entity_id: vehicleId,
        field_name: 'engine',
        field_value: engine,
        validation_source: 'title_document',
        confidence_score: 100,
        source_url: imageUrl,
        notes: `Factory engine from SPID RPO code`
      });
    }

    if (validations.length > 0) {
      await supabase.from('data_validations').insert(validations);
    }

    // Add RPO codes to vehicle_dynamic_data
    const dynamicData = spidData.rpo_codes.map(rpo => {
      const spec = RPO_DATABASE[rpo];
      return {
        vehicle_id: vehicleId,
        field_name: `RPO_${rpo}`,
        field_value: spec ? spec.name : `Factory Option ${rpo}`,
        field_category: 'factory_specs',
        is_verified: true
      };
    });

    if (dynamicData.length > 0) {
      await supabase.from('vehicle_dynamic_data').insert(dynamicData);
    }

    console.log(`✅ Auto-filled ${Object.keys(updates).length} fields from SPID sheet`);
    console.log(`✅ Added ${spidData.rpo_codes.length} RPO codes to vehicle profile`);

    return new Response(
      JSON.stringify({
        success: true,
        vehicle: vehicle,
        updates: updates,
        rpo_codes: spidData.rpo_codes,
        options: options
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error auto-filling from SPID:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

