# Edge Function Governance (Stop Calling the Wrong Ones)

**Status**: CANONICAL  
**Last Verified**: 2026-01-10  

## Core rule

Treat Edge Functions like a public API surface:

- **Only a small allowlist is “meant to be called”** (from frontend, cron, scripts).
- Everything else is either **internal** (only called by an orchestrator/queue worker) or **deprecated** (must not be called directly).

This is how we stop repetitive “wrong function” runs and drift.

## BaT (Bring a Trailer) — approved workflow

### Canonical extractors (the only ones you should target)

- **Step 1 (core profile)**: `extract-premium-auction`
- **Step 2 (comments/bids)**: `extract-auction-comments` (best-effort in free mode)

### Canonical batch runners

- **Queue worker**: `process-bat-extraction-queue`
- **Orchestrator**: `pipeline-orchestrator`
- **Live monitoring**: `sync-active-auctions` → `sync-bat-listing`
- **Comments restoration batch**: `restore-bat-comments` (when coverage is low)

### Deprecated BaT functions (do not call)

These are legacy entrypoints and should not be used as a “how-to” source:

- `import-bat-listing`
- `comprehensive-bat-extraction`
- `bat-extract-complete-v1`
- `bat-extract-complete-v2`
- `bat-extract-complete-v3`

## How we enforce this

### 1) Fix call sites first

Before deleting anything, make sure **frontend + orchestrators + admin tools** are calling only the allowlist.

### 2) Keep deprecated functions failing fast (410) or redirecting

We prefer **410 Gone** once callers are updated, so mistakes fail loudly.

### 3) Audit continuously

Run:

```bash
node scripts/audit-deprecated-edge-functions.cjs
```

To fail CI (or local checks) when deprecated calls exist:

```bash
node scripts/audit-deprecated-edge-functions.cjs --strict
```

## Deletion / archiving policy

1. **Remove callers** (frontend, scripts, other functions).
2. **Deploy 410** for deprecated entrypoints (or keep a short-lived redirect wrapper).
3. **Wait for a quiet period** (no calls observed) and then delete or stop deploying the function.

