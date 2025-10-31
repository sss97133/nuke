#!/bin/bash
# Fix migration sync issue

echo "🔧 Fixing migration history..."

# Mark remote-only migrations as applied locally
echo "1️⃣ Marking remote migrations as applied locally..."
supabase migration repair --status applied 20251025011724
supabase migration repair --status applied 20251025015819
supabase migration repair --status applied 20251027095304
supabase migration repair --status applied 20251027095309
supabase migration repair --status applied 20251028040336
supabase migration repair --status applied 20251028043343
supabase migration repair --status applied 20251028052243
supabase migration repair --status applied 20251028062035

echo "2️⃣ Pulling latest schema from remote..."
supabase db pull

echo "✅ Migration history fixed!"
echo "Now try: supabase db push"
