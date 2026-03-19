#!/bin/bash
# GLiNER extraction batch runner — processes BaT descriptions in 1K chunks
# Results saved to /tmp/gliner-batch-{offset}-{end}.json per chunk
# Progress logged to /tmp/gliner-extraction-log.txt
#
# Usage: bash yono/run_extraction_batches.sh [start_offset] [end_offset]
#   Default: start=5000, end=30000

cd /Users/skylar/nuke

START_OFFSET=${1:-5000}
END_OFFSET=${2:-30000}
CHUNK_SIZE=1000
BATCH_SIZE=50  # descriptions per Modal worker call
MAX_RETRIES=2

echo "============================================================"
echo "GLiNER Batch Extraction Runner"
echo "============================================================"
echo "  Range: offset $START_OFFSET to $END_OFFSET"
echo "  Chunk size: $CHUNK_SIZE"
echo "  Batch size: $BATCH_SIZE"
echo "  Estimated chunks: $(( (END_OFFSET - START_OFFSET) / CHUNK_SIZE ))"
echo "  Log: /tmp/gliner-extraction-log.txt"
echo "============================================================"
echo ""

TOTAL_ENTITIES=0
TOTAL_DESCS=0
ERRORS=0

for offset in $(seq $START_OFFSET $CHUNK_SIZE $((END_OFFSET - 1))); do
    RETRY=0
    SUCCESS=false

    while [ $RETRY -le $MAX_RETRIES ] && [ "$SUCCESS" = "false" ]; do
        if [ $RETRY -gt 0 ]; then
            echo "  Retry $RETRY/$MAX_RETRIES for offset=$offset (waiting 10s)..."
            sleep 10
        fi

        echo "=== CHUNK offset=$offset limit=$CHUNK_SIZE ($(date '+%H:%M:%S')) ==="

        # Run extraction — capture output and stderr
        OUTPUT=$(dotenvx run -- modal run yono/modal_extract.py \
            --limit $CHUNK_SIZE \
            --batch-size $BATCH_SIZE \
            --offset $offset 2>&1)
        EXIT_CODE=$?

        if [ $EXIT_CODE -ne 0 ]; then
            echo "  FAILED (exit=$EXIT_CODE, retry $RETRY/$MAX_RETRIES)"
            # Show last 5 lines of error
            echo "$OUTPUT" | tail -5
            RETRY=$((RETRY + 1))
            continue
        fi

        # Extract stats from output
        DESCS=$(echo "$OUTPUT" | grep "Descriptions processed:" | awk '{print $NF}')
        ENTS=$(echo "$OUTPUT" | grep "Total entities found:" | awk '{print $NF}')
        WALL=$(echo "$OUTPUT" | grep "Total wall-clock time:" | awk '{print $NF}' | sed 's/s//')
        THROUGHPUT=$(echo "$OUTPUT" | grep "Throughput:" | awk '{print $2}')

        if [ -z "$DESCS" ] || [ "$DESCS" = "0" ]; then
            echo "  WARNING: No descriptions processed. Output:"
            echo "$OUTPUT" | grep -E "EXTRACT|Error|error" | tail -10
            RETRY=$((RETRY + 1))
            continue
        fi

        echo "  Processed: $DESCS descriptions"
        echo "  Entities:  $ENTS"
        echo "  Wall time: ${WALL}s"
        echo "  Throughput: $THROUGHPUT desc/s"
        echo ""

        # Accumulate totals
        TOTAL_DESCS=$((TOTAL_DESCS + ${DESCS:-0}))
        TOTAL_ENTITIES=$((TOTAL_ENTITIES + ${ENTS:-0}))

        # Log to file
        echo "$(date '+%Y-%m-%d %H:%M:%S') offset=$offset descs=$DESCS entities=$ENTS wall=${WALL}s throughput=$THROUGHPUT" >> /tmp/gliner-extraction-log.txt

        SUCCESS=true
    done

    if [ "$SUCCESS" = "false" ]; then
        echo "  PERMANENTLY FAILED after $MAX_RETRIES retries: offset=$offset"
        echo "$(date '+%Y-%m-%d %H:%M:%S') offset=$offset FAILED after $MAX_RETRIES retries" >> /tmp/gliner-extraction-log.txt
        ERRORS=$((ERRORS + 1))
    fi
done

echo ""
echo "============================================================"
echo "ALL CHUNKS COMPLETE"
echo "============================================================"
echo "  Total descriptions: $TOTAL_DESCS"
echo "  Total entities:     $TOTAL_ENTITIES"
echo "  Errors:             $ERRORS"
echo "  Results in:         /tmp/gliner-batch-*.json"
echo "  Log:                /tmp/gliner-extraction-log.txt"
echo "============================================================"
