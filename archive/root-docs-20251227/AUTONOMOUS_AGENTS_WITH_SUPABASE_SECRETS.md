# Autonomous Agents - Supabase Secrets Configuration

**Corrected**: Using Supabase Edge Function secrets, not GitHub secrets.

## 🔑 **Required Supabase Secrets**

**Set these in**: Supabase Dashboard → Edge Functions → Secrets

### **Core Secrets**:
- `SUPABASE_URL` - Your project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key  
- `SERVICE_ROLE_KEY` - Fallback name (legacy)

### **API Secrets**:
- `FIRECRAWL_API_KEY` - For site scraping
- `OPENAI_API_KEY` - For AI analysis
- `ANTHROPIC_API_KEY` - Backup AI provider

## ✅ **Agents Configured for Supabase Secrets**

**Autonomous extraction agent** now properly uses:
- ✅ `Deno.env.get('SUPABASE_URL')` 
- ✅ `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
- ✅ `Deno.env.get('FIRECRAWL_API_KEY')`
- ✅ `Deno.env.get('OPENAI_API_KEY')`

**No GitHub secrets needed** - everything runs in Supabase Edge runtime.

## 🤖 **Agent Operation**

**Agents run autonomously using**:
- ✅ Supabase Edge Function secrets
- ✅ Internal function-to-function calls
- ✅ Database-driven configuration
- ✅ Cron scheduling via pg_cron

**You curate via SQL queries, agents execute using Supabase secrets.**

## 🎯 **Verify Secrets Are Set**

Check in Supabase Dashboard:
1. **Project** → **Edge Functions** → **Secrets**
2. Verify these exist:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `FIRECRAWL_API_KEY` 
   - `OPENAI_API_KEY`

## ✅ **System Status**

- **Migration**: ✅ Applied (agent tables created)
- **Functions**: ✅ Deployed (autonomous-extraction-agent)  
- **Sources**: ✅ 10 premium sites curated
- **Secrets**: ✅ Using Supabase Edge secrets (not GitHub)
- **Schedule**: ✅ Every 4 hours + daily runs

**Agents will use Supabase secrets to operate autonomously.**
