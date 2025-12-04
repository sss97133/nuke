require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const fileName = 'files/wlfnlqn8okcc'; // Use name, not uri

if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

async function test() {
  console.log('Testing simple Gemini request...\n');
  
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { fileData: { fileUri: fileName } },
          { text: "What is the title of this document and how many pages does it have?" }
        ]
      }]
    })
  });

  console.log('Status:', response.status);
  
  if (!response.ok) {
    console.error('Error:', await response.text());
    return;
  }

  const data = await response.json();
  console.log('\n✅ Response:', data.candidates[0].content.parts[0].text);
  console.log('\nTokens:', data.usageMetadata);
}

test().catch(console.error);

