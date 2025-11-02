#!/bin/bash

# Process Bronco work logs at Ernie's Upholstery
# Limit to 10 sessions to control OpenAI costs

export SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczODM2OTAyMSwiZXhwIjoyMDUzOTQ1MDIxfQ.NEbqSnSamR5f7Fqon25ierv5yJgdDy_o2nrixOej_Xg"

cd /Users/skylar/nuke/scripts

node intelligent-work-log-generator.js \
  79fe1a2b-9099-45b5-92c0-54e7f896089e \
  e796ca48-f3af-41b5-be13-5335bb422b41

