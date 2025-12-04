require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
const pdfUrl = 'https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/reference-docs/lmc%20catalog/ccComplete.pdf';

if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

async function testUpload() {
  console.log('Fetching PDF...');
  const pdfResp = await fetch(pdfUrl);
  const pdfBytes = await pdfResp.arrayBuffer();
  console.log(`PDF size: ${pdfBytes.byteLength} bytes (${(pdfBytes.byteLength / 1024 / 1024).toFixed(2)} MB)`);

  console.log('\n1. Initiating resumable upload...');
  const initResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': pdfBytes.byteLength.toString(),
      'X-Goog-Upload-Header-Content-Type': 'application/pdf',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { display_name: 'lmc_catalog_test' } })
  });

  console.log('Init response status:', initResp.status);
  console.log('Init response headers:', Object.fromEntries(initResp.headers.entries()));
  
  if (!initResp.ok) {
    console.error('Init failed:', await initResp.text());
    return;
  }

  const uploadUrl = initResp.headers.get('x-goog-upload-url');
  console.log('Upload URL:', uploadUrl);

  if (!uploadUrl) {
    console.error('No upload URL received');
    return;
  }

  console.log('\n2. Uploading file bytes...');
  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': pdfBytes.byteLength.toString(),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: pdfBytes
  });

  console.log('Upload response status:', uploadResp.status);
  
  if (!uploadResp.ok) {
    console.error('Upload failed:', await uploadResp.text());
    return;
  }

  const fileData = await uploadResp.json();
  console.log('\n✅ File uploaded:', JSON.stringify(fileData, null, 2));
}

testUpload().catch(console.error);

