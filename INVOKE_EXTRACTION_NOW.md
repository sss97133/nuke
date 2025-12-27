# INVOKE EXTRACTION NOW 🚀

## Quick: Use Supabase Dashboard

1. **Go to Functions Dashboard:**
   https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/functions

2. **Find `extract-all-orgs-inventory`**

3. **Click "Invoke Function"**

4. **Paste this payload:**
```json
{
  "limit": 10,
  "offset": 0,
  "min_vehicle_threshold": 1,
  "dry_run": false
}
```

5. **Click "Invoke"** 🔥

6. **Watch it work!** Check the Logs tab to see progress.

---

## Or Use Terminal (if you have env vars set):

```bash
export SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key-here"

npm run extract-inventory -- --limit=10 --offset=0 --threshold=1
```

---

## Continue Processing More Batches:

After first batch completes, run again with incremented offset:

```json
{"limit": 10, "offset": 10, "min_vehicle_threshold": 1, "dry_run": false}
{"limit": 10, "offset": 20, "min_vehicle_threshold": 1, "dry_run": false}
{"limit": 10, "offset": 30, "min_vehicle_threshold": 1, "dry_run": false}
...
```

Keep going until all 164 orgs are processed! 💪

