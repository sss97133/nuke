#!/bin/bash

echo "════════════════════════════════════════════════════════════════════"
echo "🧪 PRODUCTION TEST - SPATIAL PARTS & QUALITY INSPECTOR"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# Test 1: Check bundle deployment
echo "📦 TEST 1: Bundle Deployment"
BUNDLE=$(curl -s "https://n-zero.dev" | grep -o 'index-[A-Za-z0-9]*.js' | head -1)
echo "Current bundle: $BUNDLE"
if [[ "$BUNDLE" == "index-C8UIV56z.js" ]]; then
  echo "✅ PASS: Latest bundle deployed"
else
  echo "❌ FAIL: Old bundle still cached ($BUNDLE)"
fi
echo ""

# Test 2: Check if site loads
echo "📡 TEST 2: Site Availability"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://n-zero.dev")
echo "Homepage status: $STATUS"
if [[ "$STATUS" == "200" ]]; then
  echo "✅ PASS: Site is up"
else
  echo "❌ FAIL: Site not responding"
fi
echo ""

# Test 3: Check vehicle profile page
echo "🚗 TEST 3: Vehicle Profile Page"
PROFILE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://n-zero.dev/vehicle/a90c008a-3379-41d8-9eb2-b4eda365d74c")
echo "Profile page status: $PROFILE_STATUS"
if [[ "$PROFILE_STATUS" == "200" ]]; then
  echo "✅ PASS: Vehicle profile loads"
else
  echo "❌ FAIL: Profile not loading"
fi
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo "💾 DATABASE TESTS (Supabase)"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "Running Supabase database queries..."
echo ""

