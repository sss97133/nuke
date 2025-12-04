const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function indexCatalog() {
  console.log('Triggering index-reference-document...');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/index-reference-document`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({
      pdf_url: 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf'
    })
  });

  const result = await response.json();
  console.log('Result:', JSON.stringify(result, null, 2));
}

indexCatalog();

