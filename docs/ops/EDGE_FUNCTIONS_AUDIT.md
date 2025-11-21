# Supabase Edge Functions Audit

## Status: COMPLETED

## Overview

- **Count**: ~70 functions.
- **Core Logic**: `vehicle-expert-agent` implements the "Rhizomatic Layer" valuation logic.
- **MCP Usage**: Currently, these functions are monolithic Deno scripts. They do **not** expose MCP interfaces, nor are they documented via MCP.
- **Data Access**: Direct Supabase client usage (`supabase-js`). This is expected for Edge Functions but bypasses the Phoenix Contexts.

## `vehicle-expert-agent` Analysis

- **Purpose**: Generates `ExpertValuation` JSON from vehicle images/metadata.
- **Alignment**: Matches the "Rhizomatic Layer" definition (Environmental Context + Market Intelligence).
- **Issue**: The logic is isolated in TypeScript/Deno. The Phoenix backend (`PricingController`) likely triggers this via HTTP or Supabase Hooks, creating a split-brain logic between Elixir and TypeScript.

## Recommendation

1. **Treat Edge Functions as "Workers"**: They should only process data and write back to Supabase tables (`vehicle_valuations`).
2. **Phoenix as Orchestrator**: The `NukeApi.Pricing` context should read the results from the DB, rather than trying to replicate the logic.
3. **MCP Integration**: We should document these functions in `API_CONTRACTS.md` so the team knows *what* they do, even if they don't use MCP protocol directly.

