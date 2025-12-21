#!/bin/bash

# Deploy Agents for 1M Profiles in 30 Days
# Deploys all pipeline agents and orchestrator for 33k+ profiles/day scale

set -e

echo "🚀 Deploying Pipeline Agents for Scale..."
echo "Target: 1,000,000 profiles in 30 days (33,333/day)"
echo ""

# Check if Supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found. Please install it first."
    exit 1
fi

# Deploy core agents
echo "📦 Deploying core agents..."

echo "  🤖 Agent Orchestrator..."
supabase functions deploy agent-orchestrator

echo "  🔍 Debug Agent..."
supabase functions deploy agent-debug

echo "  🔥 Firecrawl Optimization Agent..."
supabase functions deploy agent-firecrawl-optimization

echo "  🗄️ Database Optimizer Agent..."
supabase functions deploy agent-database-optimizer

echo ""
echo "✅ Core agents deployed!"
echo ""

# Test the orchestrator
echo "🧪 Testing agent system..."

echo "  📊 Checking agent status..."
curl -X POST "$(supabase status | grep 'API URL' | awk '{print $3}')/functions/v1/agent-orchestrator" \
  -H "Authorization: Bearer $(supabase status | grep 'service_role key' | awk '{print $3}')" \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}' \
  | jq '.'

echo ""
echo "  📈 Getting scale metrics..."
curl -X POST "$(supabase status | grep 'API URL' | awk '{print $3}')/functions/v1/agent-orchestrator" \
  -H "Authorization: Bearer $(supabase status | grep 'service_role key' | awk '{print $3}')" \
  -H "Content-Type: application/json" \
  -d '{"action": "scale_metrics"}' \
  | jq '.performance'

echo ""
echo "✅ Agent system is running!"
echo ""

# Show usage examples
echo "📚 Agent Usage Examples:"
echo ""
echo "1. Check if pipeline can handle 33k/day:"
echo "   curl -X POST 'your-supabase-url/functions/v1/agent-orchestrator' \\"
echo "        -H 'Authorization: Bearer service_key' \\"
echo "        -d '{\"action\": \"scale_metrics\"}'"
echo ""
echo "2. Run emergency debug:"
echo "   curl -X POST 'your-supabase-url/functions/v1/agent-orchestrator' \\"
echo "        -d '{\"action\": \"emergency_debug\"}'"
echo ""
echo "3. Optimize for scale:"
echo "   curl -X POST 'your-supabase-url/functions/v1/agent-orchestrator' \\"
echo "        -d '{\"action\": \"scale_optimization\"}'"
echo ""
echo "4. Run daily pipeline (33k profiles):"
echo "   curl -X POST 'your-supabase-url/functions/v1/agent-orchestrator' \\"
echo "        -d '{\"action\": \"daily_pipeline_run\", \"params\": {\"target_profiles\": 33333}}'"
echo ""

echo "🎯 For 1M profiles in 30 days, run this daily:"
echo "   ./scripts/run-daily-pipeline.sh"
echo ""

echo "✨ All agents ready for scale!"
