# Comprehensive QA Report

**Generated**: 2026-02-01T11:10:05.994Z
**Duration**: 78.8s

## Summary

| Status | Count |
|--------|-------|
| ✅ Passed | 23 |
| ❌ Failed | 9 |
| ⚠️ Warnings | 7 |
| ⏭️ Skipped | 1 |
| **Total** | **40** |

## Results by Category

### Edge Functions

| Test | Status | Message | Duration |
|------|--------|---------|----------|
| search | ✅ pass | 200 in 1695ms | 1695ms |
| db-stats | ✅ pass | 200 in 8602ms | 8602ms |
| universal-search | ❌ fail | 500: {"success":false,"error":"Unexpected end of J | 191ms |
| decode-vin | ❌ fail | 500: {"error":"Unexpected end of JSON input"} | 300ms |
| test-health | ✅ pass | 200 in 136ms | 136ms |
| platform-status | ✅ pass | 200 in 288ms | 288ms |
| system-stats | ⏭️ skip | 404: {"code":"NOT_FOUND","message":"Requested func | 100ms |
| bat-simple-extract | ❌ fail | 400: {"error":"Invalid BaT listing URL"} | 216ms |
| extract-cars-and-bids-core | ❌ fail | 400: {"error":"Invalid Cars & Bids URL"} | 196ms |
| extract-hagerty-listing | ❌ fail | 500: {"error":"Invalid Hagerty Marketplace URL"} | 168ms |
| extract-vehicle-data-ai | ❌ fail | 500: {"success":false,"error":"OpenAI API error: { | 248ms |
| extract-premium-auction | ❌ fail | 500: {"success":false,"error":"Extractor extract-v | 344ms |

### Database Integrity

| Test | Status | Message | Duration |
|------|--------|---------|----------|
| Orphaned vehicle_images (null vehicle_id) | ⚠️ warn | 2,808 images with null vehicle_id | - |
| Vehicles without primary_image_url | ✅ pass | 51,457 of 208,738 (24.7%) | - |
| Duplicate VINs | ✅ pass | 0 VINs appear multiple times | - |
| Invalid year values (<1885 or >2030) | ✅ pass | 20 vehicles with invalid years | - |
| Vehicles missing make | ⚠️ warn | 4,491 vehicles | - |
| Vehicles missing model | ✅ pass | 86 vehicles | - |
| Organizations without business_name | ✅ pass | 0 orgs | - |

### Data Quality

| Test | Status | Message | Duration |
|------|--------|---------|----------|
| Suspicious prices (<$100 or >$50M) | ⚠️ warn | 20 vehicles | - |
| Mileage over 1,000,000 | ✅ pass | 28 vehicles | - |
| Possible test/dummy vehicles | ⚠️ warn | 238 vehicles | - |
| Image URLs not starting with http | ✅ pass | 0 of 20 sampled | - |
| Vehicles added in last 24h | ✅ pass | 17,740 new vehicles | - |

### Search

| Test | Status | Message | Duration |
|------|--------|---------|----------|
| "porsche 911" | ✅ pass | 20 results, top type: vehicle, 1257ms | 1257ms |
| "c10" | ⚠️ warn | 60 results, top type: vehicle, 7920ms | 7920ms |
| "mustang" | ✅ pass | 62 results, top type: vehicle, 1878ms | 1878ms |
| "mecum" | ⚠️ warn | 6 results, top type: organization, 13074ms | 13074ms |
| "1967 camaro" | ✅ pass | 20 results, top type: vehicle, 3217ms | 3217ms |
| "corvette" | ✅ pass | 72 results, top type: vehicle, 3161ms | 3161ms |
| "ferrari" | ✅ pass | 66 results, top type: vehicle, 3528ms | 3528ms |
| "bmw" | ❌ fail | 69 results, top type: organization, 2938ms | 2938ms |
| "toyota" | ✅ pass | 62 results, top type: vehicle, 3794ms | 3794ms |
| "bring a trailer" | ⚠️ warn | 26 results, top type: organization, 5636ms | 5636ms |

### RPC Functions

| Test | Status | Message | Duration |
|------|--------|---------|----------|
| calculate_portfolio_value_server | ✅ pass | Success in 569ms | 569ms |

### Table Access

| Test | Status | Message | Duration |
|------|--------|---------|----------|
| vehicles | ✅ pass | 208,741 rows, 115ms | 115ms |
| businesses | ✅ pass | 2,230 rows, 151ms | 151ms |
| profiles | ✅ pass | 5 rows, 216ms | 216ms |
| vehicle_images | ❌ fail |  | 8184ms |
| auction_comments | ✅ pass | 8,269,084 rows, 975ms | 975ms |

## Failed Tests Detail

### Edge Functions: universal-search
- **Message**: 500: {"success":false,"error":"Unexpected end of JSON input","results":[],"query_type":"text","total_coun

### Edge Functions: decode-vin
- **Message**: 500: {"error":"Unexpected end of JSON input"}

### Edge Functions: bat-simple-extract
- **Message**: 400: {"error":"Invalid BaT listing URL"}

### Edge Functions: extract-cars-and-bids-core
- **Message**: 400: {"error":"Invalid Cars & Bids URL"}

### Edge Functions: extract-hagerty-listing
- **Message**: 500: {"error":"Invalid Hagerty Marketplace URL"}

### Edge Functions: extract-vehicle-data-ai
- **Message**: 500: {"success":false,"error":"OpenAI API error: {\n    \"error\": {\n        \"message\": \"You exceeded

### Edge Functions: extract-premium-auction
- **Message**: 500: {"success":false,"error":"Extractor extract-vehicle-data-ai failed: Edge Function returned a non-2xx

### Search: "bmw"
- **Message**: 69 results, top type: organization, 2938ms

### Table Access: vehicle_images
- **Message**: 

## Warnings Detail

- **Database Integrity: Orphaned vehicle_images (null vehicle_id)** - 2,808 images with null vehicle_id
- **Database Integrity: Vehicles missing make** - 4,491 vehicles
- **Data Quality: Suspicious prices (<$100 or >$50M)** - 20 vehicles
- **Data Quality: Possible test/dummy vehicles** - 238 vehicles
- **Search: "c10"** - 60 results, top type: vehicle, 7920ms
- **Search: "mecum"** - 6 results, top type: organization, 13074ms
- **Search: "bring a trailer"** - 26 results, top type: organization, 5636ms

