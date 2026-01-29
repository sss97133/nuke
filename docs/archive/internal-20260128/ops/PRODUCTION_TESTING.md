# Production Testing Guide

## Overview

This guide outlines the procedures for testing the Nuke platform in a production environment.

## Smoke Tests

After every deployment, run the following checks:

1. **Load Homepage**: Verify critical assets load (< 2s).
2. **Login Flow**: Authenticate with a test user.
3. **Vehicle Profile**: Load a known vehicle ID and verify all tabs (Evidence, Facts, Commerce, Financials) render.
4. **Search**: Perform a search and verify results appear.

## Automated Verification

Run the included Playwright suite against the production URL:

```bash
npx playwright test --project=production
```

## Deployment Verification

Check that the new bundle is live:

```bash
curl -s https://n-zero.dev | grep -o '_next/static/[^/]*' | head -1
```

