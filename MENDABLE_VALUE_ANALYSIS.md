# Mendable's Role in Your System

## Your Goal
Fill your Supabase DB with structured vehicle data (VIN, year, make, model, price, etc.)

## What You Already Have
✅ `scrape-vehicle` - Extracts data from listing URLs
✅ `extract-vehicle-data-ai` - AI-powered extraction for unknown sources
✅ `dataRouter` - Finds/creates vehicles in DB
✅ Firecrawl - Bypasses 403 errors
✅ Universal data extraction framework

## What Mendable Does
❌ Does NOT extract structured data to your DB
✅ DOES make ingested websites searchable via chat
✅ DOES help you FIND listings to scrape

## Mendable's Actual Value for You

### 1. Discovery Tool
Instead of manually finding listings, you can query:
- "Show me all 1972 K5 Blazers on Bring a Trailer"
- "Find squarebody trucks under $30k"
- "List all Broncos from 1968-1977"

### 2. Market Intelligence
- "What's the average price for 1974 Blazers?"
- "Which vehicles sold fastest?"
- "What are common issues mentioned in listings?"

### 3. But NOT Direct DB Population
Mendable doesn't extract VIN, year, make, model, etc. into your DB.
You still need to:
1. Query Mendable to find listings
2. Get the URLs
3. Feed URLs to `scrape-vehicle`
4. Let your existing pipeline extract & store data

## The Workflow
```
Mendable Query → Get Listing URLs → scrape-vehicle → dataRouter → DB
     (Discovery)      (URLs)         (Extraction)   (Storage)
```

## Bottom Line
Mendable = Smart search/discovery
Your pipeline = Data extraction & storage

Mendable helps you FIND what to scrape, but your existing tools do the actual work.
