# Mendable (Nuke integration)

This repo uses Mendable as an **external knowledge base**. The canonical integration pattern is:

- **Supabase Edge Function** (`supabase/functions/query-mendable-v2`) acts as a server-side proxy
- `MENDABLE_API_KEY` stays **server-side** (Supabase Edge Function secrets)
- Frontend/tools call the Edge Function (or call Mendable directly for local debugging)

## Setup

### 1) Configure the Mendable API key (server-side)

Set `MENDABLE_API_KEY` in:

- Supabase Dashboard → **Edge Functions** → **Secrets**

Do **not** commit secret values anywhere in the repo.

### 2) Deploy the Edge Function

Deploy `query-mendable-v2` (preferred) to Supabase.

## Usage

### Query Mendable (recommended: via Edge Function)

Invoke `query-mendable-v2` with a JSON body:

- `question` (string): the user question
- `history` (array, optional): Mendable chat history objects (`{ prompt, response, sources? }`)
- `conversation_id` (number, optional)
- `num_chunks` (number, optional): mapped to `retriever_option.num_chunks`
- `where` (object, optional): metadata filter
- `shouldStream` (boolean, optional): defaults to `false`

The function prefers the current docs endpoint and falls back automatically:

- `POST https://api.mendable.ai/v1/mendableChat` (preferred)
- `POST https://api.mendable.ai/v1/chat` (legacy fallback)
- `POST https://api.mendable.ai/v1/newChat` (Bearer fallback)

### Local smoke test (direct Mendable API)

This repo includes a tiny connectivity check that **never prints the key**:

```bash
MENDABLE_API_KEY=... node scripts/test-mendable-chat.js "your question"
```

If you want an automated agent (like Cursor) to run this, set `MENDABLE_API_KEY` in the agent/runtime environment (not in chat).

## Troubleshooting

### 400 errors on `/v1/mendableChat`

Mendable’s `mendableChat` endpoint expects `history` (can be `[]`). The Edge Function now always includes it.

### “MENDABLE_API_KEY not configured”

The Edge Function runtime secrets are missing. Add `MENDABLE_API_KEY` in Supabase Edge Function secrets and redeploy.

