#!/bin/bash
# Setup Vercel Environment Variables

echo "Setting up Vercel environment variables..."

# Use echo to provide input to vercel env add commands
echo "https://qkgaybvrernstplzjaam.supabase.co" | vercel env add VITE_SUPABASE_URL production
echo "<your-supabase-anon-key>" | vercel env add VITE_SUPABASE_ANON_KEY production

echo "Core environment variables configured!"