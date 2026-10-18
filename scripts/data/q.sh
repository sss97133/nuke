#!/bin/bash
# usage: q.sh "SQL"  — read-only queries via Supabase Management API (recovered from session f889b190)
cd /Users/skylar/nuke
dotenvx run -q -- bash -c 'jq -n --arg q "$1" "{query:\$q}" | curl -s --max-time 60 -X POST "https://api.supabase.com/v1/projects/qkgaybvrernstplzjaam/database/query" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @-' _ "$1"
