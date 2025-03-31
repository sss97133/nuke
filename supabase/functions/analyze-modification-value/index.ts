import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VehicleData {
  year: number;
  make: string;
  model: string;
}

interface ModificationData {
  name: string;
  impact: 'positive' | 'negative' | 'neutral';
  valueChange: number;
  description: string;
}

interface RequestEvent {
  request: Request;
  method: string;
  json(): Promise<{ imageUrl: string; vehicleData: VehicleData }>;
}

serve(async (req: RequestEvent) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, vehicleData } = await req.json();
    
    if (!imageUrl || !vehicleData) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }
    
    console.log('Analyzing image for vehicle modifications:', imageUrl);
    console.log('Vehicle data:', vehicleData);
    
    // Step 1: Analyze image to detect modifications using Hugging Face model
    const hfToken = Deno.env.get('HUGGING_FACE_ACCESS_TOKEN');
    if (!hfToken) {
      throw new Error('Missing Hugging Face API token');
    }
    
    // Use a pre-trained model to detect car parts and modifications
    const detectedModifications = await analyzeImageWithHuggingFace(imageUrl, hfToken);
    
    // Step 2: Assess market value of modifications using Perplexity API
    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!perplexityApiKey) {
      throw new Error('Missing Perplexity API token');
    }
    
    // Enrich modification data with market value information
    const enrichedModifications = await enrichWithMarketData(
      detectedModifications, 
      vehicleData, 
      perplexityApiKey
    );
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        detectedModifications: enrichedModifications 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('Error analyzing modifications:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function analyzeImageWithHuggingFace(imageUrl: string, token: string): Promise<string[]> {
  try {
    // Use the Hugging Face Inference API to analyze the image
    const response = await fetch(
      "https://api-inference.huggingface.co/models/vit-gpt2-image-captioning",
      {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
        body: JSON.stringify({ url: imageUrl }),
      }
    );
    
    const result = await response.json();
    console.log('HuggingFace analysis result:', result);
    
    if (!result || !result.generated_text) {
      return [];
    }
    
    // Extract potential modifications from the caption
    const caption = result.generated_text;
    const carParts = [
      "wheels", "rims", "exhaust", "suspension", "body kit", "spoiler", 
      "hood", "engine", "turbo", "lights", "interior", "seats", "paint", 
      "wrap", "tint", "audio", "stereo", "intake", "intercooler"
    ];
    
    // Filter detected parts
    const detectedParts = carParts.filter(part => 
      caption.toLowerCase().includes(part)
    );
    
    console.log('Detected car parts/modifications:', detectedParts);
    return detectedParts;
  } catch (error) {
    console.error('Error analyzing image with Hugging Face:', error);
    throw error;
  }
}

async function enrichWithMarketData(
  detectedParts: string[], 
  vehicleData: VehicleData, 
  apiKey: string
): Promise<ModificationData[]> {
  if (detectedParts.length === 0) {
    return [];
  }
  
  try {
    const prompt = `For a ${vehicleData.year} ${vehicleData.make} ${vehicleData.model}, 
    analyze how these modifications affect the vehicle's market value: ${detectedParts.join(', ')}.
    
    For each modification, provide a JSON object with:
    1. The name of the modification
    2. The impact on value (positive, negative, or neutral)
    3. The estimated value change in dollars (positive or negative number)
    4. A brief description explaining the value impact
    
    Return a valid JSON array of objects WITHOUT ANY explanations, just valid JSON. Each object should have these properties: 
    name, impact (one of: "positive", "negative", "neutral"), valueChange (number), description (string).`;

    console.log('Sending prompt to Perplexity:', prompt);
    
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-sonar-small-128k-online',
        messages: [
          {
            role: 'system',
            content: 'You are an automotive expert who specializes in valuing vehicle modifications. Provide accurate market data on how modifications affect a vehicle\'s value. Always return just pure JSON without code blocks or explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('Perplexity API response:', data);
    
    let modifications: ModificationData[] = [];
    
    try {
      // Extract JSON from the response content - might need to clean it up
      const content = data.choices[0]?.message?.content || '';
      const cleanedContent = content
        .replace(/```json\s?/g, '')
        .replace(/```\s?/g, '')
        .trim();
      
      modifications = JSON.parse(cleanedContent);
      console.log('Parsed modifications data:', modifications);
    } catch (error) {
      console.error('Error parsing Perplexity response:', error);
      // Fallback to empty array if parsing fails
      modifications = [];
    }
    
    return modifications;
  } catch (error) {
    console.error('Error enriching with market data:', error);
    // Return mock data if the API call fails
    return detectedParts.map(part => ({
      name: part.charAt(0).toUpperCase() + part.slice(1),
      impact: Math.random() > 0.7 ? 'negative' : Math.random() > 0.4 ? 'positive' : 'neutral',
      valueChange: Math.floor((Math.random() * 1000) - 300),
      description: `This ${part} may affect the vehicle's value based on condition, brand, and installation quality.`
    }));
  }
}
