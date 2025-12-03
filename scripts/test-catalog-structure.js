const apiKey = 'AIzaSyCTXqzxp5oRPoW745dHZjGDQ2yFOd4fvDQ';
const fileUri = 'https://generativelanguage.googleapis.com/v1beta/files/wlfnlqn8okcc';

const prompt = `Analyze this automotive parts catalog.

Extract:
1. Total page count
2. Table of contents (all major sections with page ranges)
3. Vehicle coverage (years/models)
4. Catalog organization (how parts are grouped)

Return JSON:
{
  "total_pages": number,
  "title": "string",
  "vehicle_coverage": ["1973-1987 Chevy/GMC Trucks"],
  "sections": [
    {"name": "Section Name", "start_page": 1, "end_page": 50, "category": "exterior|interior|engine|etc"}
  ]
}`;

async function analyze() {
  console.log('Analyzing catalog structure with Gemini 1.5 Pro...\n');
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { fileData: { fileUri: fileUri, mimeType: "application/pdf" } },
          { text: prompt }
        ]
      }],
      generationConfig: { 
        response_mime_type: "application/json",
        temperature: 0
      }
    })
  });

  console.log('Response status:', response.status);
  
  if (!response.ok) {
    console.error('Error:', await response.text());
    return;
  }

  const data = await response.json();
  const text = data.candidates[0].content.parts[0].text;
  const result = JSON.parse(text);
  
  console.log(JSON.stringify(result, null, 2));
  console.log(`\nTokens used:`, data.usageMetadata);
}

analyze().catch(console.error);

