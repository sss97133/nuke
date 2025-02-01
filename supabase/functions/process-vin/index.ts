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
  make: string;
  model: string;
  year: string;
  manufacturer: string;
  plantCountry: string;
  vehicleType: string;
  bodyClass: string;
  driveType: string;
  fuelType: string;
  engineCylinders: string;
  engineHP: string;
  transmissionStyle: string;
  doors: string;
  safetyRating: string;
  series: string;
  trim: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
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
      // Convert image to base64 and process with OCR if no VIN provided
      const buffer = await image.arrayBuffer()
      const base64Image = btoa(String.fromCharCode(...new Uint8Array(buffer)))

      // Use Hugging Face for OCR
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

    console.log('Fetching NHTSA data for VIN:', vinToProcess)

    // Fetch detailed vehicle information from NHTSA
    const nhtsaResponse = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinextended/${vinToProcess}?format=json`
    )
    
    if (!nhtsaResponse.ok) {
      throw new Error('Failed to fetch NHTSA data')
    }

    const nhtsaData: NHTSAResponse = await nhtsaResponse.json()
    console.log('NHTSA Response received')

    // Process and structure the NHTSA data
    const processedData: ProcessedVehicleData = {
      make: findNHTSAValue(nhtsaData.Results, 'Make') || '',
      model: findNHTSAValue(nhtsaData.Results, 'Model') || '',
      year: findNHTSAValue(nhtsaData.Results, 'Model Year') || '',
      manufacturer: findNHTSAValue(nhtsaData.Results, 'Manufacturer Name') || '',
      plantCountry: findNHTSAValue(nhtsaData.Results, 'Plant Country') || '',
      vehicleType: findNHTSAValue(nhtsaData.Results, 'Vehicle Type') || '',
      bodyClass: findNHTSAValue(nhtsaData.Results, 'Body Class') || '',
      driveType: findNHTSAValue(nhtsaData.Results, 'Drive Type') || '',
      fuelType: findNHTSAValue(nhtsaData.Results, 'Fuel Type - Primary') || '',
      engineCylinders: findNHTSAValue(nhtsaData.Results, 'Engine Number of Cylinders') || '',
      engineHP: findNHTSAValue(nhtsaData.Results, 'Engine Horse Power') || '',
      transmissionStyle: findNHTSAValue(nhtsaData.Results, 'Transmission Style') || '',
      doors: findNHTSAValue(nhtsaData.Results, 'Doors') || '',
      safetyRating: findNHTSAValue(nhtsaData.Results, 'NCSA Note') || '',
      series: findNHTSAValue(nhtsaData.Results, 'Series') || '',
      trim: findNHTSAValue(nhtsaData.Results, 'Trim') || '',
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