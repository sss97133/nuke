#!/bin/bash
# End-to-End Document Upload Test
# Tests: UI flow + Database trigger + Timeline event creation

set -e

VEHICLE_ID="eea40748-cdc1-4ae9-ade1-4431d14a7726" # Bronco
DB_URL="postgresql://postgres:RbzKq32A0uhqvJMQ@db.qkgaybvrernstplzjaam.supabase.co:5432/postgres"
SITE_URL="https://nuke-rust.vercel.app"

echo "🧪 DOCUMENT UPLOAD E2E TEST"
echo "=============================="
echo ""

# Step 1: Check current state
echo "📊 Step 1: Checking current timeline events..."
BEFORE_COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = '$VEHICLE_ID';")
echo "   Current timeline events: $BEFORE_COUNT"
echo ""

# Step 2: Create sample receipt
echo "📄 Step 2: Creating sample receipt..."
cat > /tmp/test_receipt.txt << 'EOF'
AUTOZONE
Store #4532
123 Main Street
Los Angeles, CA 90001

Date: 10/27/2025
Invoice: AZ-2025-10271534

Item                    Qty  Price   Total
----------------------------------------
Brake Pads (Front)       1   $85.00  $85.00
Oil Filter Premium       2   $12.25  $24.50
Shop Supplies           1   $17.95  $17.95

Subtotal:                        $127.45
Tax (9.5%):                       $12.11
Total:                           $139.56

Payment Method: VISA ****1234
Thank you for shopping at AutoZone!
EOF
echo "   ✅ Sample receipt created at /tmp/test_receipt.txt"
echo ""

# Step 3: Test with Playwright (browser automation)
echo "🌐 Step 3: Testing upload flow in browser..."
echo "   Navigating to $SITE_URL/vehicle/$VEHICLE_ID"
echo ""

# Note: This requires @playwright/test to be installed
# For now, we'll output the manual test steps
cat << 'MANUAL_TEST'
📋 MANUAL BROWSER TEST (or use Playwright CLI):
================================================

1. Navigate to: https://nuke-rust.vercel.app/vehicle/eea40748-cdc1-4ae9-ade1-4431d14a7726

2. Look for "+ Add Receipt" button in the Valuation section

3. Click "+ Add Receipt"
   → Should open fullscreen modal with:
     - Header: "📄 Upload Document"
     - Step 1: Category grid (8 types)
     - Step 2: Upload zone

4. "Receipt" should be pre-selected (or click it)

5. Click "Choose File" or drag the sample receipt:
   /tmp/test_receipt.txt

6. Watch for:
   - "⏳ Uploading..."
   - "⏳ Parsing with AI..."
   - Preview appears with parsed data

7. Verify preview shows:
   - Vendor: AutoZone (or similar)
   - Date: 10/27/2025 (or parsed date)
   - Total: ~$139.56

8. Click "💾 Save Document"

9. Should see success message and modal closes

MANUAL_TEST

echo ""
echo "⏸️  Press Enter after completing the manual upload test..."
read -r

# Step 4: Verify database
echo ""
echo "🔍 Step 4: Verifying database..."
echo ""

echo "   Checking timeline_events..."
AFTER_COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM timeline_events WHERE vehicle_id = '$VEHICLE_ID';")
NEW_EVENTS=$((AFTER_COUNT - BEFORE_COUNT))

if [ "$NEW_EVENTS" -gt 0 ]; then
    echo "   ✅ NEW timeline events created: $NEW_EVENTS"
else
    echo "   ❌ NO new timeline events found!"
    exit 1
fi

echo ""
echo "   Fetching latest timeline event..."
psql "$DB_URL" -c "
SELECT 
    id,
    title,
    event_type,
    source,
    source_type,
    event_date,
    metadata->>'vendor' AS vendor,
    metadata->>'amount' AS amount,
    created_at
FROM timeline_events
WHERE vehicle_id = '$VEHICLE_ID'
ORDER BY created_at DESC
LIMIT 1;
"

echo ""
echo "   Checking vehicle_documents..."
psql "$DB_URL" -c "
SELECT 
    id,
    document_type,
    title,
    vendor_name,
    amount,
    document_date,
    timeline_event_id IS NOT NULL AS has_timeline_link,
    created_at
FROM vehicle_documents
WHERE vehicle_id = '$VEHICLE_ID'
ORDER BY created_at DESC
LIMIT 1;
"

echo ""
echo "   Checking receipts table..."
psql "$DB_URL" -c "
SELECT 
    id,
    vendor_name,
    total_amount,
    receipt_date,
    created_at
FROM receipts
WHERE scope_type = 'vehicle' AND scope_id = '$VEHICLE_ID'
ORDER BY created_at DESC
LIMIT 1;
"

echo ""
echo "=============================="
echo "🎉 E2E TEST COMPLETE"
echo ""
echo "Expected Results:"
echo "  ✅ New timeline_events row with:"
echo "     - source = 'document_upload'"
echo "     - source_type = 'receipt'"
echo "     - event_date = 2025-10-27 (or document date)"
echo "     - metadata contains vendor/amount"
echo ""
echo "  ✅ New vehicle_documents row with:"
echo "     - document_type = 'receipt'"
echo "     - timeline_event_id IS NOT NULL"
echo ""
echo "  ✅ New receipts row with parsed data"
echo ""

