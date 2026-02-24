# 🔧 Migration System Fix - October 30, 2025

## ❌ Problem

Migration system is completely out of sync:
- **64 local migrations** never applied to remote
- **8 remote migrations** don't exist in local files
- `supabase db push` fails
- Can't repair (files missing)

**Root Cause:** Background agents (or manual work) applied SQL directly to database, bypassing migration system.

---

## ✅ Solution (2 Steps)

### **Step 1: Apply Critical Fixes Manually** (5 minutes)

Since migrations are broken, apply fixes directly:

1. **Open Supabase SQL Editor:**
   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql

2. **Copy/paste contents of:** `APPLY_THESE_SQL_FIXES.sql`

3. **Click "Run"**

This will:
- ✅ Refresh schema cache (fix `created_by` error)
- ✅ Fix price save permissions
- ✅ Fix image upload permissions  
- ✅ Fix document upload permissions

---

### **Step 2: Reset Migration System** (10 minutes)

After fixes are applied and tested, reset migrations:

```bash
cd /Users/skylar/nuke

# Backup current migrations
mv supabase/migrations supabase/migrations.backup

# Create fresh migrations directory
mkdir supabase/migrations

# Pull current schema as baseline
supabase db pull

# This creates ONE migration with current state
```

**Result:** Clean slate, in sync with production.

---

## 📱 After Step 1: Test These on Mobile

Before resetting migrations, **verify the SQL fixes worked:**

1. **Add Vehicle Test:**
   - Open https://nuke.ag on phone
   - Tap + button
   - Enter: 1977 Chevrolet K5 Blazer
   - Add photo
   - Save
   - ✅ Should work (no `created_by` error)

2. **Edit Price Test:**
   - Open any vehicle you own
   - Go to Price tab
   - Change purchase price to $15,000
   - Save
   - ✅ Should save successfully

3. **Upload Document Test:**
   - Open any vehicle you own
   - Go to Docs tab
   - Upload a receipt
   - ✅ Should upload successfully

---

## 🎯 Why This Approach?

**Option A (What we tried):** Repair migration history
- ❌ Failed - missing migration files
- ❌ Too complex - 64 migrations to reconcile

**Option B (This approach):** Apply fixes + reset
- ✅ Fixes applied immediately
- ✅ Test before committing to reset
- ✅ Clean slate for future migrations

---

## 📋 Status

- ✅ SQL fix file created: `APPLY_THESE_SQL_FIXES.sql`
- ⏳ **Action required:** Apply SQL fixes in Supabase dashboard
- ⏳ **Action required:** Test on mobile
- ⏳ **Then:** Reset migrations (Step 2)

---

## 🚨 Important

**Do NOT skip Step 1 testing!**

If SQL fixes don't work:
- We need to debug actual errors
- Before resetting migrations
- So we don't lose ability to diagnose

**Test on mobile first, report results.**

---

**Files:**
- `APPLY_THESE_SQL_FIXES.sql` - Copy/paste into Supabase SQL Editor
- `MIGRATION_FIX_INSTRUCTIONS.md` - This file

