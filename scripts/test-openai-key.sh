#!/bin/bash

# Test OpenAI API Key Diagnosis

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          OpenAI API Key Diagnostic                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "1. Checking Supabase Edge Function secrets..."
echo ""
supabase secrets list | grep OPENAI_API_KEY
echo ""

echo "2. Testing Edge Function response..."
echo ""
ANON_KEY="${SUPABASE_ANON_KEY:-${VITE_SUPABASE_ANON_KEY:-}}"

echo "Calling analyze-image-tier1 function..."
RESPONSE=$(curl -s -X POST \
  "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/analyze-image-tier1" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url":"https://qkgaybvrernstplzjaam.supabase.co/storage/v1/object/public/vehicle-images/18377b38-4232-4549-ba36-acce06b7f67e/dee16914-99c1-4106-a25c-bdd6601dc83d.jpg","image_id":"test","estimated_resolution":"medium"}')

echo "Response: $RESPONSE"
echo ""

if echo "$RESPONSE" | grep -q "401"; then
  echo "❌ 401 Error - OpenAI key is invalid or expired"
  echo ""
  echo "Possible causes:"
  echo "  1. Key expired (OpenAI keys can expire)"
  echo "  2. Key format wrong (should be sk-proj-...)"
  echo "  3. Billing issue on OpenAI account"
  echo "  4. Rate limit exceeded"
  echo ""
  echo "Fix:"
  echo "  1. Get fresh key from: https://platform.openai.com/api-keys"
  echo "  2. Update secret: supabase secrets set OPENAI_API_KEY=sk-proj-new-key"
  echo ""
elif echo "$RESPONSE" | grep -q "error"; then
  echo "⚠️  Other error detected:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  echo ""
else
  echo "✅ Function responded successfully!"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
fi

echo ""
echo "3. Checking recent Edge Function logs for details..."
echo ""
echo "To see full logs, run:"
echo "  supabase functions logs analyze-image-tier1"
echo ""
echo "Or check dashboard:"
echo "  https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/logs/edge-functions"

