#!/bin/bash
# Quick deploy script for openai-proxy edge function
# Run this after setting SUPABASE_ACCESS_TOKEN

set -e

# Check for access token
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "Error: SUPABASE_ACCESS_TOKEN not set"
    echo ""
    echo "To get your access token:"
    echo "1. Go to https://app.supabase.com/account/tokens"
    echo "2. Create a new token"
    echo "3. Run: export SUPABASE_ACCESS_TOKEN=your_token_here"
    echo "4. Then run this script again"
    exit 1
fi

PROJECT_REF="qkgaybvrernstplzjaam"

echo "Deploying openai-proxy to project $PROJECT_REF..."

cd "$(dirname "$0")/.."

# Install Supabase CLI if needed
if ! command -v supabase &> /dev/null; then
    echo "Installing Supabase CLI..."
    npm install -g supabase
fi

# Link project
supabase link --project-ref "$PROJECT_REF"

# Deploy the function
supabase functions deploy openai-proxy --no-verify-jwt

echo ""
echo "✅ openai-proxy deployed successfully!"
echo ""
echo "Test it:"
echo "curl -X POST https://$PROJECT_REF.supabase.co/functions/v1/openai-proxy \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"model\": \"gpt-4o\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'"
