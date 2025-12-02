# Repository Organization Summary

## Root Directory (Clean)
- `README.md` - Main project documentation
- Core folders only: `docs/`, `scripts/`, `supabase/`, `nuke_frontend/`, `nuke_api/`

## Documentation (`docs/`)
Organized into 19 categorized folders:

- **`docs/ksl-scraper/`** - KSL import system documentation
- **`docs/reference-system/`** - Component knowledge base system
- **`docs/systems/`** - System architecture documents
- **`docs/features/`** - Feature documentation
- **`docs/guides/`** - How-to guides and setup instructions
- **`docs/development/`** - Development notes, session summaries
- **`docs/deployment/`** - Deployment procedures
- **`docs/imports/`** - Import system documentation (BAT, Craigslist, etc.)
- **`docs/data/`** - Database documentation
- **`docs/workflows/`** - Process workflows
- **`docs/archive/`** - Old/obsolete documentation

## Data Files (`data/`)
- **`data/json/`** - JSON data files (listings, extractions, etc.)
- **`data/sql/`** - SQL scripts and queries

## Archive (`archive/`)
- **`archive/logs/`** - Log files, PID files
- **`archive/old-scripts/`** - Deprecated shell scripts
- **`archive/temp/`** - Temporary HTML, text files
- **`archive/backups/`** - Backup files

## Configuration (`config/`)
- Playwright, Vitest, Vercel config files

## Screenshots (`screenshots/`)
- PNG screenshots and images

## Active Directories (Unchanged)
- **`scripts/`** - Active Node.js scripts
- **`supabase/`** - Database migrations, edge functions
- **`nuke_frontend/`** - React frontend
- **`nuke_api/`** - Elixir backend
- **`tests/`** - Test files
- **`tools/`** - Development tools

---

**Total files organized:** 250+  
**Before:** 229 markdown files + 50+ other files in root  
**After:** Clean, categorized, navigable structure  

All changes committed and pushed to GitHub.
