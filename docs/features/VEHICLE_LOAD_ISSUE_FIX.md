# Vehicle Load Issue - RPC Returning Null

## Problem

The vehicle `59743025-be7a-466f-abba-6bf0be29f33f` is not loading because:
1. RPC `get_vehicle_profile_data` returns `null` (no error, just null)
2. Fallback query should work but vehicle state stays null

## Root Cause

The RPC function `get_vehicle_profile_data` catches ALL exceptions and returns `NULL` if ANY subquery fails. This means:
- If images query fails → returns NULL
- If timeline_events query fails → returns NULL  
- If ANY related table has an issue → returns NULL

The function doesn't distinguish between "vehicle doesn't exist" and "related data query failed".

## Current Status

✅ **Direct query works** - Vehicle is accessible with anon key  
✅ **Vehicle data is correct** - `is_public = true`, `status = 'active'`, `profile_origin = 'dropbox_import'`  
❌ **RPC returns null** - One of the subqueries is likely failing silently

## Solution

The RPC should return the vehicle even if related data queries fail. Update the function to:
1. Always return vehicle data (even if related queries fail)
2. Return empty arrays for failed subqueries instead of NULL
3. Log which subquery failed for debugging

## Quick Fix

The frontend fallback should work, but there might be a timing issue. The vehicle should load via the fallback query since:
- RLS allows access (`is_public = true`)
- Direct query works
- Vehicle exists and has correct data

**Try:** Hard refresh the page (Cmd+Shift+R) - the fallback query should load the vehicle.

## Long-term Fix

Update `get_vehicle_profile_data` RPC to be more resilient:
- Don't return NULL if vehicle exists
- Return vehicle with empty arrays for failed subqueries
- Add better error logging

