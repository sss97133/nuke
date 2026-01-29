#!/bin/bash

# Continuous test runner - runs for 30 minutes
DURATION_SECONDS=1800
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_SECONDS))
RUN_COUNT=0
PASS_COUNT=0
FAIL_COUNT=0

echo "=========================================="
echo "🔄 Continuous Testing Started"
echo "Duration: 30 minutes"
echo "Start: $(date)"
echo "End: $(date -r $END_TIME 2>/dev/null || date -d @$END_TIME)"
echo "=========================================="
echo ""

while [ $(date +%s) -lt $END_TIME ]; do
    RUN_COUNT=$((RUN_COUNT + 1))
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    REMAINING=$((END_TIME - CURRENT_TIME))

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📊 Run #$RUN_COUNT | Elapsed: ${ELAPSED}s | Remaining: ${REMAINING}s"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Run playwright tests
    npx playwright test test-continuous.spec.ts --reporter=list 2>&1

    if [ $? -eq 0 ]; then
        PASS_COUNT=$((PASS_COUNT + 1))
        echo "✅ Run #$RUN_COUNT PASSED"
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "❌ Run #$RUN_COUNT FAILED"
    fi

    echo ""
    echo "📈 Stats: $PASS_COUNT passed, $FAIL_COUNT failed out of $RUN_COUNT runs"

    # Wait 30 seconds between runs
    if [ $(date +%s) -lt $END_TIME ]; then
        echo "⏳ Waiting 30s before next run..."
        sleep 30
    fi
done

echo ""
echo "=========================================="
echo "🏁 Continuous Testing Complete"
echo "End: $(date)"
echo "Total Runs: $RUN_COUNT"
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"
echo "Success Rate: $(echo "scale=1; $PASS_COUNT * 100 / $RUN_COUNT" | bc)%"
echo "=========================================="
