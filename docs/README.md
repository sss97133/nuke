# Documentation Organization

This directory contains all project documentation, organized as follows:

## Structure

- **`archive/`** - Historical documentation from completed features, fixes, and implementations
  - Contains `*COMPLETE*.md`, `*FIX*.md`, `*IMPLEMENTATION*.md` files
  - Archived `.txt` files and old documentation
  
- **`audits/`** - System audits, status reports, and test results
  - Contains `*AUDIT*.md`, `*TEST*.md`, `*STATUS*.md` files
  - Production verification reports
  
- **`deployment/`** - Deployment guides and production checklists
  - Contains `*DEPLOY*.md`, `*PRODUCTION*.md`, `*SHIP*.md`, `*LIVE*.md` files
  - Deployment procedures and verification steps

## Active Documentation

Keep only active, current documentation in the root `docs/` directory. Archive completed work regularly.

## Related Directories

- **`/scripts/`** - All executable scripts
  - `/scripts/shell/` - Shell scripts (`.sh`)
  - `/scripts/sql/` - SQL migration and utility scripts (`.sql`)
  
- **`/supabase/migrations/`** - Official database migrations (versioned)

