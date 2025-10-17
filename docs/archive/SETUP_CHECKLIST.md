# Setup Checklist - Professional Receipt System

## ✅ What I Fixed

### 1. CORS Error → Backend Proxy ✅
- Created backend controller: `receipt_parser_controller.ex`
- Added route: `POST /api/receipts/parse`
- Frontend now calls backend (no more CORS errors)
- API key stays secure on server

### 2. File Storage → Proper S3 Uploads ✅
- Updated `receiptService.ts` to upload to `tool-data` bucket
- Organized by user: `tool-data/{user_id}/receipts/filename.pdf`
- Falls back to base64 if RLS not configured (graceful degradation)
- No more database bloat

### 3. Clear Instructions ✅
- Step-by-step RLS policy setup guide
- Backend environment configuration
- Testing procedures

---

## 🔧 What You Need To Do

### Step 1: Add Claude API Key to Backend

**File:** `/Users/skylar/nuke/nuke_api/.env`

Add this line at the end:

```bash
CLAUDE_API_KEY=sk-ant-YOUR-KEY-FROM-CONSOLE-ANTHROPIC-COM
```

Get your key: https://console.anthropic.com/

Then restart backend:
```bash
cd /Users/skylar/nuke/nuke_api
mix phx.server
```

### Step 2: Fix RLS Policies in Supabase Dashboard

**Go to:** https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/storage/policies

**Add 4 policies for tool-data bucket:**

1. **INSERT Policy** (Allow uploads):
   ```sql
   bucket_id = 'tool-data' 
   AND (storage.foldername(name))[1] = auth.uid()::text
   ```

2. **SELECT Policy** (Allow reads):
   ```sql
   bucket_id = 'tool-data' 
   AND (storage.foldername(name))[1] = auth.uid()::text
   ```

3. **UPDATE Policy** (Allow updates):
   ```sql
   bucket_id = 'tool-data' 
   AND (storage.foldername(name))[1] = auth.uid()::text
   ```

4. **DELETE Policy** (Allow deletes):
   ```sql
   bucket_id = 'tool-data' 
   AND (storage.foldername(name))[1] = auth.uid()::text
   ```

**Detailed guide:** `FIX_TOOL_DATA_BUCKET.md`

---

## 🧪 Test Everything Works

### Test 1: Backend is Running
```bash
curl http://localhost:4000/api/health
# Should return: {"status":"ok"}
```

### Test 2: Upload a Receipt
1. Open app: http://localhost:5174/profile
2. Go to Professional Toolbox tab
3. Upload a Snap-on receipt PDF
4. Watch console logs:
   - ✅ "Uploading to tool-data bucket" = RLS policies working!
   - ⚠️ "Falling back to base64" = RLS policies not configured yet

### Test 3: Check S3 Bucket
1. Go to Supabase Dashboard → Storage → tool-data
2. Should see folders: `{your-user-id}/receipts/`
3. Files should be there with proper names

---

## 📁 File Structure After Setup

```
tool-data/                          ← S3 Bucket
  └── {user-id}/                    ← User's folder
      └── receipts/                 ← Receipt folder
          ├── 1234567890_snap-on-receipt.pdf
          ├── 1234567891_mac-tools.jpg
          └── ...
```

Database stores:
- Receipt metadata (vendor, date, total)
- Line items (tools purchased)
- File URL (points to S3)
- **NOT** the actual file content

---

## 🎯 Expected Results

### Before RLS Fix:
- ⚠️ Files stored as base64 in database
- 📊 Database bloat (~33% larger)
- 🐌 Slower queries

### After RLS Fix:
- ✅ Files stored in S3 bucket
- 🚀 Fast database queries
- 💾 Proper file organization
- 📈 Scales to millions of files

---

## 📚 Reference Files

- `FIX_TOOL_DATA_BUCKET.md` - Detailed RLS setup guide
- `CLAUDE_API_SETUP.md` - Backend proxy documentation
- `ADD_CLAUDE_KEY_HERE.txt` - Quick key setup reminder

---

## ❓ Troubleshooting

**"RLS policy violation"**
→ RLS policies not configured. See `FIX_TOOL_DATA_BUCKET.md`

**"Claude API key not configured"**
→ Add to `/Users/skylar/nuke/nuke_api/.env` and restart backend

**"Files still using base64"**
→ Check console logs. If seeing fallback messages, RLS needs fixing

**"Backend not responding"**
→ Check if running: `curl http://localhost:4000/api/health`
