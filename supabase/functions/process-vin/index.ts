import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NHTSAResponse {
  Results: Array<{
    Value: string | null;
    ValueId: string | null;
    Variable: string;
    VariableId: number;
  }>;
}

interface ProcessedVehicleData {
  basic: {
    make: string;
    model: string;
    year: string;
    manufacturer: string;
  };
  manufacturing: {
    plantCountry: string;
    plantState?: string;
    plantCity?: string;
    manufacturerAddress?: string;
  };
  specifications: {
    engineType?: string;
    engineCylinders: string;
    engineHP: string;
    fuelType: string;
    transmissionStyle: string;
    transmissionSpeeds?: string;
    driveType: string;
    steeringLocation?: string;
  };
  characteristics: {
    vehicleType: string;
    bodyClass: string;
    doors: string;
    windows?: string;
    wheelBaseLong?: string;
    wheelBaseType?: string;
    trackWidth?: string;
    grossVehicleWeight?: string;
    series: string;
    trim: string;
  };
  safety: {
    safetyRating: string;
    airBagLocations?: string;
    antiLockBrakingSystem?: string;
    tractionControlType?: string;
    pretensioner?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const formData = await req.formData()
    const image = formData.get('image')
    const vin = formData.get('vin')?.toString()

    console.log('Processing VIN request:', { vin, hasImage: !!image })

    let vinToProcess = vin

    if (!vinToProcess && image && image instanceof File) {
      const buffer = await image.arrayBuffer()
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(buffer)))

      const response = await fetch(
        'https://api-inference.huggingface.co/models/microsoft/trocr-large-printed',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('HUGGING_FACE_ACCESS_TOKEN')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: base64Image }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to process image with OCR')
      }

      const result = await response.json()
      console.log('OCR Result:', result)

      const text = result[0]?.generated_text || ''
      const vinMatch = text.match(/[A-HJ-NPR-Z0-9]{17}/)
      vinToProcess = vinMatch ? vinMatch[0] : null
    }

    if (!vinToProcess) {
      return new Response(
        JSON.stringify({ error: 'No valid VIN found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Fetching extended NHTSA data for VIN:', vinToProcess)

    const nhtsaResponse = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinextended/${vinToProcess}?format=json`
    )
    
    if (!nhtsaResponse.ok) {
      throw new Error('Failed to fetch NHTSA data')
    }

    const nhtsaData: NHTSAResponse = await nhtsaResponse.json()
    console.log('NHTSA Response received with', nhtsaData.Results.length, 'fields')

    const processedData: ProcessedVehicleData = {
      basic: {
        make: findNHTSAValue(nhtsaData.Results, 'Make') || '',
        model: findNHTSAValue(nhtsaData.Results, 'Model') || '',
        year: findNHTSAValue(nhtsaData.Results, 'Model Year') || '',
        manufacturer: findNHTSAValue(nhtsaData.Results, 'Manufacturer Name') || '',
      },
      manufacturing: {
        plantCountry: findNHTSAValue(nhtsaData.Results, 'Plant Country') || '',
        plantState: findNHTSAValue(nhtsaData.Results, 'Plant State'),
        plantCity: findNHTSAValue(nhtsaData.Results, 'Plant City'),
        manufacturerAddress: findNHTSAValue(nhtsaData.Results, 'Plant Address'),
      },
      specifications: {
        engineType: findNHTSAValue(nhtsaData.Results, 'Engine Model'),
        engineCylinders: findNHTSAValue(nhtsaData.Results, 'Engine Number of Cylinders') || '',
        engineHP: findNHTSAValue(nhtsaData.Results, 'Engine Horse Power') || '',
        fuelType: findNHTSAValue(nhtsaData.Results, 'Fuel Type - Primary') || '',
        transmissionStyle: findNHTSAValue(nhtsaData.Results, 'Transmission Style') || '',
        transmissionSpeeds: findNHTSAValue(nhtsaData.Results, 'Transmission Speeds'),
        driveType: findNHTSAValue(nhtsaData.Results, 'Drive Type') || '',
        steeringLocation: findNHTSAValue(nhtsaData.Results, 'Steering Location'),
      },
      characteristics: {
        vehicleType: findNHTSAValue(nhtsaData.Results, 'Vehicle Type') || '',
        bodyClass: findNHTSAValue(nhtsaData.Results, 'Body Class') || '',
        doors: findNHTSAValue(nhtsaData.Results, 'Doors') || '',
        windows: findNHTSAValue(nhtsaData.Results, 'Windows'),
        wheelBaseLong: findNHTSAValue(nhtsaData.Results, 'Wheel Base Long'),
        wheelBaseType: findNHTSAValue(nhtsaData.Results, 'Wheel Base Type'),
        trackWidth: findNHTSAValue(nhtsaData.Results, 'Track Width'),
        grossVehicleWeight: findNHTSAValue(nhtsaData.Results, 'Gross Vehicle Weight Rating'),
        series: findNHTSAValue(nhtsaData.Results, 'Series') || '',
        trim: findNHTSAValue(nhtsaData.Results, 'Trim') || '',
      },
      safety: {
        safetyRating: findNHTSAValue(nhtsaData.Results, 'NCSA Note') || '',
        airBagLocations: findNHTSAValue(nhtsaData.Results, 'Air Bag Locations'),
        antiLockBrakingSystem: findNHTSAValue(nhtsaData.Results, 'Anti-lock Braking System (ABS)'),
        tractionControlType: findNHTSAValue(nhtsaData.Results, 'Traction Control Type'),
        pretensioner: findNHTSAValue(nhtsaData.Results, 'Pretensioner'),
      }
    }

    console.log('Processed vehicle data:', processedData)

    return new Response(
      JSON.stringify({
        vin: vinToProcess,
        data: processedData,
        rawData: nhtsaData.Results,
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    )
  } catch (error) {
    console.error('Error processing VIN:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: error.stack 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

function findNHTSAValue(results: NHTSAResponse['Results'], variableName: string): string | null {
  const item = results.find(r => r.Variable === variableName)
  return item?.Value || null
}