# GitHub Actions Workflow Failures - Missing Secrets

## Problem

The `bat_local_partners_inventory.yml` workflow is failing because GitHub Actions secrets are missing or incorrectly configured.

## Required Secrets

The workflow needs these secrets in GitHub Actions:

### 1. SUPABASE_URL
- **Name**: `SUPABASE_URL` (or `SUPABASE_PROJECT_URL` or `SUPABASEPROJECTURL`)
- **Value**: `https://qkgaybvrernstplzjaam.supabase.co`
- **Location**: GitHub → Settings → Secrets and variables → Actions → Repository secrets

### 2. SUPABASE_ANON_JWT
- **Name**: `SUPABASE_ANON_JWT` (or `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`)
- **Value**: Must be the **JWT format** key (starts with `eyJ...`), NOT an `sb_*` key
- **Valid JWT**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk`
- **Location**: GitHub → Settings → Secrets and variables → Actions → Repository secrets

## How to Fix

1. Go to: https://github.com/sss97133/nuke/settings/secrets/actions
2. Add/Update these secrets:
   - `SUPABASE_URL` = `https://qkgaybvrernstplzjaam.supabase.co`
   - `SUPABASE_ANON_JWT` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk`

## Validation in Workflow

The workflow validates secrets at startup:
- If `SUPABASE_URL` is empty → exits with code 2
- If `SUPABASE_ANON_JWT` is empty → exits with code 2
- If `SUPABASE_ANON_JWT` starts with `sb_` → exits with code 2 (must be JWT format)

## Why It's Failing

All 13 workflow runs are failing in 7-12 seconds, which indicates they're exiting at the secret validation step (lines 28-39 in the workflow file) before making any API calls.

## After Fixing

Once the secrets are set correctly:
1. The workflow will pass secret validation
2. It will proceed to call the Edge Functions
3. The workflow should complete successfully

