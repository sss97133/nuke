# Apply Migration: received_in_trade Column

## Quick Apply (Supabase Dashboard)

1. Go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql/new
2. Copy and paste this SQL:

```sql
ALTER TABLE vehicles 
  ADD COLUMN IF NOT EXISTS received_in_trade BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vehicles_received_in_trade 
  ON vehicles(received_in_trade) 
  WHERE received_in_trade = true;

COMMENT ON COLUMN vehicles.received_in_trade IS 
  'Indicates if this vehicle was received as part of a trade transaction (including partial trades)';
```

3. Click "Run" to execute

## Verification

After applying, verify the column exists:

```sql
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'vehicles' 
AND column_name = 'received_in_trade';
```

You should see:
- column_name: `received_in_trade`
- data_type: `boolean`
- column_default: `false`

## Migration File

The migration file is located at:
`supabase/migrations/20250128_add_received_in_trade_column.sql`
