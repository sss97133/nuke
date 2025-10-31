#!/bin/bash
SERVICE_KEY="REDACTED-ROTATE-THIS-KEY"

# Execute SQL directly
psql "postgresql://postgres.qkgaybvrernstplzjaam@db.qkgaybvrernstplzjaam.supabase.co:5432/postgres" \
  -f DEPLOY_PROFESSIONAL_FINANCIAL_SYSTEM.sql
