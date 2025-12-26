# Why Do We Have Two APIs? 🤔

## Quick Answer

You have **TWO different backend systems** working together:

1. **Supabase** - Your main database and backend service (handles most data)
2. **Phoenix API** (`nuke_api`) - A separate Elixir server for special processing (handles complex operations)

---

## 1. Supabase (Primary Backend) 🗄️

**What it is:**
- A hosted PostgreSQL database with built-in authentication
- Your frontend talks to Supabase **directly** for most things
- Handles: vehicles, images, user accounts, timeline events, etc.

**How it works:**
```typescript
// Your frontend code does this:
const { data } = await supabase
  .from('vehicles')
  .select('*')
  .eq('id', vehicleId);
```

**Why use it:**
- ✅ Fast - Direct database access
- ✅ Secure - Built-in Row Level Security (RLS)
- ✅ Real-time - Can subscribe to changes
- ✅ Free tier available

---

## 2. Phoenix API (`nuke_api`) - The "Other" API 🔧

**What it is:**
- A separate Elixir/Phoenix server running on port 4000
- Handles operations that need **server-side processing**
- Located at: `http://localhost:4000/api` (or `https://n-zero.dev/api` in production)

**What it's used for:**
- ✅ **Receipt parsing** - Complex AI processing of receipt images
- ✅ **Vehicle scraping** - Web scraping operations
- ✅ **Complex business logic** - Operations that need server-side processing
- ✅ **API endpoints** - Some REST endpoints that wrap Supabase operations

**Example from your code:**
```typescript
// From universalReceiptParser.ts
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const response = await fetch(`${API_BASE_URL}/receipts/parse`, {
  method: 'POST',
  body: formData
});
```

---

## Why Do You Need Both? 🤷

### Supabase is great for:
- ✅ Simple database queries (get vehicle, update vehicle)
- ✅ User authentication
- ✅ File storage
- ✅ Real-time subscriptions

### Phoenix API is needed for:
- ✅ **Complex processing** - Things that need server-side computation
- ✅ **AI operations** - Receipt parsing, image analysis
- ✅ **Web scraping** - Can't do this from the browser
- ✅ **API rate limiting** - Control access to external services
- ✅ **Background jobs** - Long-running tasks

---

## About `NEXT_PUBLIC_API_BASE_URL` 📝

**UPDATE:** After checking your codebase, you **DO NOT have a Next.js app**. You're using **Vite/React**, so you don't need `NEXT_PUBLIC_API_BASE_URL` at all!

**What you actually need:**
- `VITE_API_URL` - This is what your Vite frontend uses to call the Phoenix API
- Currently set to: `http://localhost:4000/api` (for development)
- In production, it should be: `https://n-zero.dev/api`

---

## Your Current Setup 🏗️

Based on your codebase:

1. **Main Frontend** (`nuke_frontend`):
   - React/Vite app
   - Uses Supabase directly for most data
   - Uses Phoenix API for receipt parsing and other special operations
   - Environment variable: `VITE_API_URL=http://localhost:4000/api`

2. **Phoenix Backend** (`nuke_api`):
   - Elixir/Phoenix server
   - Runs on port 4000
   - Provides API endpoints at `/api/*`
   - Can also call Supabase internally

3. **Your Frontend** (Vite/React):
   - Deployed at `https://n-zero.dev` (based on vercel.json)
   - Uses `VITE_API_URL` to call the Phoenix API
   - This is your ONLY frontend - there's no Next.js app

---

## Do You Actually Need the Phoenix API? 🤔

**You might NOT need it if:**
- You're only using Supabase for everything
- You don't need receipt parsing
- You don't need web scraping
- All your operations can be done client-side or via Supabase Edge Functions

**You DO need it if:**
- You use receipt parsing (you do - see `universalReceiptParser.ts`)
- You need server-side processing
- You want to keep API keys secret (can't put them in frontend)
- You need complex business logic

---

## Summary 📋

- **Supabase** = Your main database/backend (use this for most things)
- **Phoenix API** = Special operations server (use this for complex processing)
- **VITE_API_URL** = Tells your Vite frontend where the Phoenix API is (this is what you need, NOT NEXT_PUBLIC_API_BASE_URL)

They work together! Supabase handles the data, Phoenix API handles the heavy lifting.

