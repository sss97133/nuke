# Database Setup Instructions

Since the database connection limit is reached, please run this manually:

## Option 1: Supabase Dashboard (Recommended)

1. **Go to Supabase Dashboard**: https://supabase.com/dashboard
2. **Select your project**: `qkgaybvrernstplzjaam`
3. **Navigate to SQL Editor**: Click "SQL Editor" in the sidebar
4. **Copy and paste** the entire contents of `database_setup.sql`
5. **Click "Run"** to execute

## Option 2: Command Line (when connections available)

```bash
cd /Users/skylar/nuke/nuke_frontend
export PGPASSWORD="<your_db_password>"
psql "postgresql://postgres.qkgaybvrernstplzjaam:${PGPASSWORD}@aws-0-us-west-1.pooler.supabase.com:5432/postgres" -f database_setup.sql
```

## What This Will Create:

✅ **8 missing database tables**:
- `vehicle_builds` - Build projects and budgets
- `vehicle_contributors` - User permissions (owner, consigner, etc.)
- `vehicle_receipts` - Expense tracking
- `vehicle_moderators` - Content moderation
- `vehicle_sale_settings` - Marketplace configuration
- `vehicle_interaction_sessions` - Live tours/streaming
- `component_installations` - Parts tracking
- `vehicle_data` - Extended specifications

✅ **Row Level Security (RLS)** enabled with basic policies
✅ **Indexes** for performance
✅ **Foreign key relationships** to existing tables

## Expected Result:

After running this script, all the 400/404/406 database errors should be eliminated and the vehicle profile will work perfectly!