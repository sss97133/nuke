#!/bin/bash

# Daily Pipeline Runner for 33,333 Profiles/Day
# This script should be run daily (via cron) to hit 1M profiles in 30 days

set -e

# Configuration
TARGET_DAILY_PROFILES=33333
BATCH_SIZE=1000
MAX_CONCURRENT_EXTRACTIONS=50
RETRY_ATTEMPTS=3

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get Supabase URL and Service Key
SUPABASE_URL=$(supabase status | grep 'API URL' | awk '{print $3}')
SERVICE_KEY=$(supabase status | grep 'service_role key' | awk '{print $3}')

if [ -z "$SUPABASE_URL" ] || [ -z "$SERVICE_KEY" ]; then
    echo -e "${RED}❌ Could not get Supabase credentials. Is supabase running?${NC}"
    exit 1
fi

AGENT_URL="$SUPABASE_URL/functions/v1/agent-orchestrator"

log() {
    echo -e "${BLUE}$(date '+%Y-%m-%d %H:%M:%S')${NC} $1"
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

call_agent() {
    local action="$1"
    local params="$2"
    
    curl -s -X POST "$AGENT_URL" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"action\": \"$action\", \"params\": $params}" \
        | jq '.'
}

echo "🚀 Starting Daily Pipeline for 1M Profiles in 30 Days"
echo "📊 Target: $TARGET_DAILY_PROFILES profiles today"
echo "⏰ Started at: $(date)"
echo ""

# Step 1: Check system health
log "🔍 Checking system health..."
health_result=$(call_agent "status" "{}")
overall_health=$(echo "$health_result" | jq -r '.overall_health // 0')

if (( $(echo "$overall_health < 0.8" | bc -l) )); then
    error "System health is below 80% ($overall_health). Running emergency debug..."
    debug_result=$(call_agent "emergency_debug" "{}")
    echo "$debug_result" | jq '.recommended_actions[]' || true
    warning "Continuing with caution..."
else
    success "System health: $(echo "$overall_health * 100" | bc -l)%"
fi

# Step 2: Get current scale metrics
log "📈 Checking current scale metrics..."
metrics_result=$(call_agent "scale_metrics" "{}")
current_rate=$(echo "$metrics_result" | jq -r '.performance.daily_rate_current // 0')
on_track=$(echo "$metrics_result" | jq -r '.performance.on_track_for_1m // false')

if [ "$on_track" = "true" ]; then
    success "On track for 1M profiles! Current rate: $current_rate/day"
else
    warning "Behind target. Current rate: $current_rate/day (need $TARGET_DAILY_PROFILES/day)"
fi

# Step 3: Optimize for scale if needed
if (( $(echo "$current_rate < $TARGET_DAILY_PROFILES * 0.8" | bc -l) )); then
    log "⚡ Running scale optimization..."
    optimize_result=$(call_agent "scale_optimization" "{}")
    success "Scale optimization completed"
fi

# Step 4: Run the main daily pipeline
log "🏭 Starting main extraction pipeline..."
pipeline_start=$(date +%s)

pipeline_result=$(call_agent "daily_pipeline_run" "{
    \"target_profiles\": $TARGET_DAILY_PROFILES,
    \"batch_size\": $BATCH_SIZE,
    \"max_concurrent\": $MAX_CONCURRENT_EXTRACTIONS
}")

pipeline_end=$(date +%s)
pipeline_duration=$((pipeline_end - pipeline_start))

# Extract results
total_steps=$(echo "$pipeline_result" | jq -r '.total_steps // 0')
successful_steps=$(echo "$pipeline_result" | jq -r '.successful_steps // 0')
final_metrics=$(echo "$pipeline_result" | jq '.final_metrics')

if [ "$successful_steps" = "$total_steps" ]; then
    success "Pipeline completed successfully ($successful_steps/$total_steps steps)"
else
    warning "Pipeline completed with issues ($successful_steps/$total_steps steps)"
fi

# Step 5: Get final metrics
log "📊 Getting final metrics..."
final_result=$(call_agent "scale_metrics" "{}")
final_rate=$(echo "$final_result" | jq -r '.performance.daily_rate_current // 0')
final_on_track=$(echo "$final_result" | jq -r '.performance.on_track_for_1m // false')

echo ""
echo "📈 DAILY PIPELINE RESULTS"
echo "========================"
echo "🕒 Duration: ${pipeline_duration}s ($(echo "$pipeline_duration / 60" | bc -l) minutes)"
echo "📊 Daily rate before: $current_rate profiles/day"
echo "📊 Daily rate after:  $final_rate profiles/day"
echo "🎯 Target rate:       $TARGET_DAILY_PROFILES profiles/day"

if [ "$final_on_track" = "true" ]; then
    success "✨ ON TRACK for 1M profiles in 30 days!"
else
    error "📉 BEHIND SCHEDULE - optimization needed"
fi

# Step 6: Generate next-day recommendations
log "💡 Generating recommendations for tomorrow..."
recommendations=$(echo "$final_result" | jq -r '.recommendations[]? // empty')

if [ -n "$recommendations" ]; then
    echo ""
    echo "🔧 RECOMMENDATIONS FOR TOMORROW:"
    echo "$recommendations" | while read -r rec; do
        echo "   • $rec"
    done
fi

# Step 7: Schedule next run (if not already scheduled)
if ! crontab -l 2>/dev/null | grep -q "run-daily-pipeline.sh"; then
    warning "Daily pipeline not scheduled in cron. To schedule:"
    echo "   echo '0 2 * * * cd $(pwd) && ./scripts/run-daily-pipeline.sh >> logs/daily-pipeline.log 2>&1' | crontab -"
fi

echo ""
echo "✅ Daily pipeline completed at $(date)"
echo "📝 Progress: $(echo "$final_rate * 30" | bc -l) projected profiles in 30 days"
echo ""

# Exit with error code if significantly behind target
if (( $(echo "$final_rate < $TARGET_DAILY_PROFILES * 0.5" | bc -l) )); then
    error "CRITICAL: Daily rate is less than 50% of target. Manual intervention needed."
    exit 1
elif (( $(echo "$final_rate < $TARGET_DAILY_PROFILES * 0.8" | bc -l) )); then
    warning "WARNING: Daily rate is below 80% of target."
    exit 2
else
    success "Daily rate target achieved!"
    exit 0
fi
