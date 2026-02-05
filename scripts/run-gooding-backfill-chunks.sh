#!/usr/bin/env bash
# Run Gooding backfill in chunks. Usage: ./scripts/run-gooding-backfill-chunks.sh [chunk_size] [num_chunks] [start_offset]
# Example: ./scripts/run-gooding-backfill-chunks.sh 20 10 0   # 10 chunks of 20 = 200 lots
# Example: ./scripts/run-gooding-backfill-chunks.sh 20 50 200 # 50 chunks starting at offset 200

set -e
cd "$(dirname "$0")/.."
CHUNK=${1:-20}
NUM=${2:-10}
OFFSET=${3:-0}
echo "Gooding backfill: chunk_size=$CHUNK num_chunks=$NUM offset=$OFFSET"
npx tsx scripts/backfill-gooding-now.ts --batch "$CHUNK" --chunks "$NUM" --offset "$OFFSET"
