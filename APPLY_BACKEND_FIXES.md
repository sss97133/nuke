# Backend Database Fixes

## The Problem

Your vehicle updates are failing with 500 errors due to:
1. Missing or incomplete tables
2. Missing RLS policies
3. Broken trigger functions
4. Missing helper functions for credits system

## The Fix

I've created a comprehensive migration that:
- ✅ Fixes the blocking completion trigger
- ✅ Ensures all critical tables exist
- ✅ Applies proper RLS policies to all tables
- ✅ Creates helper functions for credits system
- ✅ Fixes vehicle image upload RLS

## How to Apply

### Option 1: Supabase Dashboard (RECOMMENDED)

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**
4. Copy and paste the entire contents of:
   ```
   supabase/migrations/20251019_comprehensive_backend_fix.sql
   ```
5. Click **Run**

### Option 2: Command Line (If credentials work)

```bash
cd /Users/skylar/nuke
supabase db push
```

## What This Fixes

### Tables Created/Ensured:
- `vehicle_timeline_events` - Timeline events for vehicles
- `work_sessions` - Work session tracking
- `receipts` - Receipt uploads
- `receipt_line_items` - Receipt line items
- `user_tools` - Tool inventory
- `user_credits` - Credit balances
- `credit_transactions` - Credit transaction history
- `vehicle_support` - Support allocations
- `builder_payouts` - Payout requests

### RLS Policies Applied:
- Profiles: View all, update own
- Timeline Events: View all, create/edit own
- Work Sessions: View if owner/contributor, create own
- Receipts: View/edit/delete own
- Tools: Full CRUD on own tools
- Credits: View own balance and transactions
- Vehicle Support: View all, create own
- Vehicle Images: Fixed contributor upload permissions

### Functions Created:
- `update_vehicle_completion()` - Non-blocking trigger
- `get_user_credit_balance()` - Get user's credit balance
- `add_credits_to_user()` - Add credits (webhook)
- `allocate_credits_to_vehicle()` - Allocate credits to vehicle

## Verification

After applying, test:
1. ✅ Update a vehicle (should not get 500 error)
2. ✅ Upload an image as contributor
3. ✅ View your profile
4. ✅ Navigate between pages

## If Issues Persist

Check browser console for specific errors and share them with me.

