import OpenAI from 'openai';

// This uses OpenAI's GPT-4 to read and extract data from BAT listings
// Since AI models can access web content differently than traditional scrapers

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;
  
  if (!url || !url.includes('bringatrailer.com')) {
    return res.status(400).json({ error: 'Invalid BAT URL' });
  }

  try {
    // Initialize OpenAI - you'll need to add your API key to .env
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Ask GPT-4 to extract vehicle data from the URL
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are a vehicle data extraction assistant. Given a Bring a Trailer URL, extract and return structured vehicle data in JSON format."
        },
        {
          role: "user",
          content: `Please extract vehicle data from this BAT listing: ${url}
          
          Return a JSON object with these fields (leave null if not found):
          - year (4-digit year)
          - make (manufacturer name)
          - model (model name including sub-model/trim if applicable)
          - mileage (number only, no commas)
          - vin (17-character VIN if available)
          - engine (engine description like "5.0L V8")
          - engine_size (just the number like "5.0")
          - transmission (like "5-Speed Manual")
          - color (exterior color)
          - sale_price (number only if sold, no $ or commas)
          - description (brief description of the vehicle)
          - images (array of image URLs, max 10)
          
          Extract data from the actual listing page, not just the URL.`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const extractedData = JSON.parse(completion.choices[0].message.content);
    
    return res.status(200).json({
      success: true,
      data: extractedData,
      source: 'AI extraction',
      listing_url: url
    });

  } catch (error) {
    console.error('AI extraction error:', error);
    
    // Fallback to URL slug parsing if AI fails
    const slugMatch = url.match(/\/listing\/([^\/]+)/);
    if (slugMatch) {
      const slug = slugMatch[1];
      const parts = slug.split('-');
      
      const yearIndex = parts.findIndex(p => /^(19|20)\d{2}$/.test(p));
      const fallbackData = {};
      
      if (yearIndex >= 0) {
        fallbackData.year = parts[yearIndex];
        if (parts[yearIndex + 1]) {
          fallbackData.make = parts[yearIndex + 1].charAt(0).toUpperCase() + parts[yearIndex + 1].slice(1);
        }
        if (parts.length > yearIndex + 2) {
          fallbackData.model = parts.slice(yearIndex + 2)
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join(' ');
        }
      }
      
      return res.status(200).json({
        success: true,
        data: fallbackData,
        source: 'URL parsing (AI unavailable)',
        listing_url: url
      });
    }
    
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to extract data',
      details: error.message 
    });
  }
}
