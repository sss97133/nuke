# Nuke API v1 Documentation

The Nuke API provides programmatic access to vehicle data, observations, and documents. Use it to integrate vehicle tracking into your applications or build custom import pipelines.

## Base URL

```
https://qkgaybvrernstplzjaam.supabase.co/functions/v1
```

## Authentication

All API requests require authentication. You can authenticate using either:

### 1. API Key (Recommended for integrations)

Generate an API key from your dashboard at `/settings/api-keys`.

```bash
curl -X GET "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles" \
  -H "X-API-Key: nk_live_xxxxxxxxxxxxxxxx"
```

### 2. Bearer Token (For browser/app sessions)

Use your Supabase JWT token:

```bash
curl -X GET "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Rate Limits

- **API Keys**: 1,000 requests/hour (default)
- **JWT Tokens**: 10,000 requests/hour
- Rate limit headers included in responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

---

## Endpoints

### Vehicles

#### List Vehicles

```
GET /api-v1-vehicles
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Items per page (max: 100, default: 20) |
| `mine` | boolean | Only return your vehicles |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "year": 1974,
      "make": "Chevrolet",
      "model": "C10",
      "vin": "CCY144Z123456",
      "mileage": 87000,
      "exterior_color": "Red",
      "sale_price": 35000,
      "is_public": false,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "pages": 3
  }
}
```

#### Get Vehicle

```
GET /api-v1-vehicles/{id}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "year": 1974,
    "make": "Chevrolet",
    "model": "C10",
    "vin": "CCY144Z123456",
    "mileage": 87000,
    "exterior_color": "Red",
    "interior_color": "Black",
    "transmission": "Automatic",
    "engine": "350 V8",
    "drivetrain": "2WD",
    "body_style": "Pickup",
    "sale_price": 35000,
    "description": "Original paint, matching numbers...",
    "is_public": false,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-20T14:00:00Z"
  }
}
```

#### Create Vehicle

```
POST /api-v1-vehicles
```

**Request Body:**
```json
{
  "year": 1974,
  "make": "Chevrolet",
  "model": "C10",
  "vin": "CCY144Z123456",
  "mileage": 87000,
  "exterior_color": "Red",
  "interior_color": "Black",
  "transmission": "Automatic",
  "engine": "350 V8",
  "drivetrain": "2WD",
  "body_style": "Pickup",
  "sale_price": 35000,
  "description": "Original paint...",
  "is_public": false
}
```

**Response:**
```json
{
  "data": { ... },
  "message": "Vehicle created successfully"
}
```

#### Update Vehicle

```
PATCH /api-v1-vehicles/{id}
```

**Request Body:** (partial update)
```json
{
  "mileage": 88500,
  "sale_price": 36000
}
```

#### Delete Vehicle

```
DELETE /api-v1-vehicles/{id}
```

Archives the vehicle (soft delete).

---

### Observations

Observations are immutable data points about a vehicle with full provenance tracking.

#### List Observations

```
GET /api-v1-observations?vehicle_id={id}
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `vehicle_id` | uuid | Vehicle ID (required if no vin) |
| `vin` | string | VIN (required if no vehicle_id) |
| `kind` | string | Filter by observation kind |
| `page` | integer | Page number |
| `limit` | integer | Items per page (max: 100) |

**Observation Kinds:**
- `mileage` - Odometer readings
- `service` - Service/maintenance records
- `sale` - Sale/auction events
- `ownership` - Ownership transfers
- `modification` - Modifications/upgrades
- `damage` - Damage/accident reports
- `valuation` - Price estimates
- `listing` - Classified listings

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "vehicle_id": "uuid",
      "source_type": "service_record",
      "observation_kind": "service",
      "observed_at": "2024-01-10T00:00:00Z",
      "data": {
        "service_type": "Oil Change",
        "shop": "Quick Lube",
        "cost": 75.00,
        "mileage": 85000
      },
      "confidence": 0.95,
      "provenance": {
        "url": "https://example.com/receipt.pdf",
        "ingested_by": "user_uuid"
      }
    }
  ]
}
```

#### Create Observation

```
POST /api-v1-observations
```

**Request Body:**
```json
{
  "vehicle_id": "uuid",
  "source_type": "manual_entry",
  "observation_kind": "mileage",
  "observed_at": "2024-01-15T00:00:00Z",
  "data": {
    "mileage": 87500,
    "notes": "Verified at oil change"
  },
  "confidence": 1.0,
  "provenance": {
    "document_id": "receipt_uuid"
  }
}
```

---

### Batch Import

Bulk import vehicles and observations in a single request.

```
POST /api-v1-batch
```

**Request Body:**
```json
{
  "vehicles": [
    {
      "year": 1974,
      "make": "Chevrolet",
      "model": "C10",
      "vin": "CCY144Z123456",
      "mileage": 87000,
      "observations": [
        {
          "source_type": "import",
          "observation_kind": "mileage",
          "data": { "mileage": 87000 }
        }
      ]
    },
    {
      "year": 1976,
      "make": "Chevrolet",
      "model": "C20",
      "vin": "CCY244Z654321"
    }
  ],
  "options": {
    "skip_duplicates": true,
    "match_by": "vin",
    "update_existing": false
  }
}
```

**Options:**
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `skip_duplicates` | boolean | true | Skip if vehicle already exists |
| `match_by` | string | "vin" | Match duplicates by: "vin", "year_make_model", "none" |
| `update_existing` | boolean | false | Update existing vehicles if found |

**Response:**
```json
{
  "success": true,
  "result": {
    "created": 2,
    "updated": 0,
    "skipped": 1,
    "failed": 0,
    "vehicles": [
      { "index": 0, "id": "uuid1", "status": "created" },
      { "index": 1, "id": "uuid2", "status": "created" },
      { "index": 2, "id": "uuid3", "status": "skipped" }
    ]
  },
  "summary": "Created: 2, Updated: 0, Skipped: 1, Failed: 0"
}
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "details": "Additional context if available"
}
```

**HTTP Status Codes:**
| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid/missing auth |
| 403 | Forbidden - Access denied |
| 404 | Not Found |
| 405 | Method Not Allowed |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

---

## Examples

### Python

```python
import requests

API_KEY = "nk_live_xxxxxxxxxxxxxxxx"
BASE_URL = "https://qkgaybvrernstplzjaam.supabase.co/functions/v1"

headers = {"X-API-Key": API_KEY}

# Create a vehicle
response = requests.post(
    f"{BASE_URL}/api-v1-vehicles",
    headers=headers,
    json={
        "year": 1974,
        "make": "Chevrolet",
        "model": "C10",
        "vin": "CCY144Z123456"
    }
)
vehicle = response.json()["data"]
print(f"Created vehicle: {vehicle['id']}")

# Add an observation
requests.post(
    f"{BASE_URL}/api-v1-observations",
    headers=headers,
    json={
        "vehicle_id": vehicle["id"],
        "source_type": "manual_entry",
        "observation_kind": "mileage",
        "data": {"mileage": 87000}
    }
)
```

### JavaScript/TypeScript

```typescript
const API_KEY = "nk_live_xxxxxxxxxxxxxxxx";
const BASE_URL = "https://qkgaybvrernstplzjaam.supabase.co/functions/v1";

const headers = { "X-API-Key": API_KEY };

// List vehicles
const response = await fetch(`${BASE_URL}/api-v1-vehicles?mine=true`, {
  headers,
});
const { data: vehicles } = await response.json();

// Batch import
const batchResponse = await fetch(`${BASE_URL}/api-v1-batch`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({
    vehicles: [
      { year: 1974, make: "Chevrolet", model: "C10" },
      { year: 1976, make: "Chevrolet", model: "C20" },
    ],
  }),
});
```

### cURL

```bash
# List your vehicles
curl -X GET "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles?mine=true" \
  -H "X-API-Key: nk_live_xxxxxxxxxxxxxxxx"

# Create a vehicle
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/api-v1-vehicles" \
  -H "X-API-Key: nk_live_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"year": 1974, "make": "Chevrolet", "model": "C10"}'
```

---

## Webhooks (Coming Soon)

Subscribe to events:
- `vehicle.created`
- `vehicle.updated`
- `observation.created`
- `document.uploaded`

---

## Support

- **Documentation**: https://nuke.com/docs/api
- **Issues**: https://github.com/nukeplatform/nuke/issues
- **Email**: api@nuke.com
