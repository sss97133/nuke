# Mendable Data Sources

## Overview
Your Mendable project has **100+ data sources** ingested, primarily from Bring a Trailer and n-zero.dev.

## Data Sources

### Bring a Trailer (bringatrailer.com)
- **Main pages**: Homepage, auctions, categories, premium listings
- **Vehicle listings**: 100+ individual vehicle auction listings including:
  - Classic cars (Corvettes, Porsches, Ferraris)
  - Trucks (K5 Blazers, Broncos, Land Cruisers)
  - Motorcycles, boats, aircraft
  - Various categories and filters
- **Content pages**: FAQ, how it works, shipping info, etc.

### n-zero.dev
- Your platform website ingested
- Ready for querying about your platform features

## API Access
- **API Key**: Configured in Supabase secrets (`MENDABLE_API_KEY`)
- **Endpoints**:
  - `/v1/getSources` - List all data sources ✅
  - `/v1/ingestData` - Add new data sources ✅
  - `/v1/newConversation` - Create chat sessions ✅

## Next Steps
1. Query the data using Mendable's chat API
2. Build search functionality into your platform
3. Use for vehicle data extraction and analysis
4. Integrate with your scraping system

