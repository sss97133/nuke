#!/bin/bash
# Check and fix wrong vehicle prices

echo "=== Checking vehicles with $1,800 price ==="
psql "$SUPABASE_DB_URL" -c "
SELECT 
  id,
  year, make, model,
  current_value,
  asking_price,
  purchase_price,
  is_for_sale
FROM vehicles 
WHERE current_value = 1800 
ORDER BY year DESC 
LIMIT 5;
"

echo ""
echo "=== To fix a specific vehicle, run: ==="
echo "psql \"\$SUPABASE_DB_URL\" -c \"UPDATE vehicles SET current_value = 140615 WHERE id = 'VEHICLE-UUID';\""
