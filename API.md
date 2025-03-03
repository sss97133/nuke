
# TAMS API Documentation

## Authentication

All API endpoints require authentication using a JWT token. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Base URL

```
https://qkgaybvrernstplzjaam.supabase.co
```

## REST Endpoints

### Vehicles

#### Get Vehicles
```http
GET /rest/v1/vehicles
```

Query Parameters:
```
select: string (comma-separated columns)
order: string (column and direction)
limit: number
offset: number
```

Response:
```json
[
  {
    "id": "uuid",
    "make": "string",
    "model": "string",
    "year": "number",
    "vin": "string",
    "notes": "string",
    "created_at": "string",
    "updated_at": "string",
    "owner_id": "uuid",
    "status": "string",
    "market_value": "number"
  }
]
```

#### Get Vehicle By ID
```http
GET /rest/v1/vehicles?id=eq.{id}
```

#### Create Vehicle
```http
POST /rest/v1/vehicles
```

Request Body:
```json
{
  "make": "string",
  "model": "string",
  "year": "number",
  "vin": "string",
  "notes": "string",
  "status": "string"
}
```

#### Update Vehicle
```http
PATCH /rest/v1/vehicles?id=eq.{id}
```

Request Body:
```json
{
  "make": "string",
  "model": "string",
  "year": "number",
  "notes": "string",
  "status": "string"
}
```

#### Delete Vehicle
```http
DELETE /rest/v1/vehicles?id=eq.{id}
```

### Inventory

#### Get Inventory Items
```http
GET /rest/v1/inventory
```

Response:
```json
[
  {
    "id": "uuid",
    "name": "string",
    "quantity": "number",
    "location": "string",
    "category": "string",
    "created_at": "string",
    "updated_at": "string",
    "price": "number",
    "supplier_id": "uuid",
    "min_quantity": "number"
  }
]
```

#### Create Inventory Item
```http
POST /rest/v1/inventory
```

Request Body:
```json
{
  "name": "string",
  "quantity": "number",
  "location": "string",
  "category": "string",
  "price": "number",
  "min_quantity": "number"
}
```

### Service Records

#### Get Service Records
```http
GET /rest/v1/service_records
```

Response:
```json
[
  {
    "id": "uuid",
    "vehicle_id": "uuid",
    "service_date": "string",
    "description": "string",
    "service_type": "string",
    "mileage": "number",
    "cost": "number",
    "technician_id": "uuid",
    "parts": "json",
    "labor_hours": "number",
    "status": "string"
  }
]
```

#### Create Service Record
```http
POST /rest/v1/service_records
```

Request Body:
```json
{
  "vehicle_id": "uuid",
  "service_date": "string",
  "description": "string",
  "service_type": "string",
  "mileage": "number",
  "cost": "number",
  "technician_id": "uuid",
  "parts": "json",
  "labor_hours": "number",
  "status": "string"
}
```

### Users & Profiles

#### Get User Profile
```http
GET /rest/v1/profiles?id=eq.{id}
```

Response:
```json
[
  {
    "id": "uuid",
    "full_name": "string",
    "avatar_url": "string",
    "user_type": "string",
    "bio": "string",
    "achievements_count": "number",
    "reputation_score": "number",
    "skills": "json",
    "certifications": "json"
  }
]
```

#### Update User Profile
```http
PATCH /rest/v1/profiles?id=eq.{id}
```

Request Body:
```json
{
  "full_name": "string",
  "avatar_url": "string",
  "bio": "string",
  "user_type": "string"
}
```

## Edge Functions

### VIN Processing
```http
POST /functions/v1/process-vin
```

Request Body:
```json
{
  "vin": "string",
  "image_url": "string"
}
```

Response:
```json
{
  "success": true,
  "vehicle_data": {
    "make": "string",
    "model": "string",
    "year": "number",
    "engine": "string",
    "trim": "string"
  }
}
```

### Market Data Collection
```http
GET /functions/v1/crawl-market-data
```

Query Parameters:
```
make: string
model: string
year: number
```

Response:
```json
{
  "success": true,
  "market_data": {
    "average_price": "number",
    "price_range": {
      "min": "number",
      "max": "number"
    },
    "listings_count": "number",
    "price_trend": "string",
    "recent_sales": [
      {
        "price": "number",
        "date": "string",
        "condition": "string"
      }
    ]
  }
}
```

### Analyze Vehicle Probability
```http
POST /functions/v1/analyze-vehicle-probability
```

Request Body:
```json
{
  "make": "string",
  "model": "string",
  "year": "number",
  "location": {
    "latitude": "number",
    "longitude": "number"
  },
  "radius": "number"
}
```

### Generate Explanation
```http
POST /functions/v1/generate-explanation
```

Request Body:
```json
{
  "concept": "string",
  "context": "string",
  "complexity": "beginner|intermediate|advanced"
}
```

## Real-time Subscriptions

### Service Tickets Updates
```javascript
supabase
  .channel('service_tickets')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'service_tickets'
  }, (payload) => {
    console.log('Change received!', payload)
  })
  .subscribe()
```

### Vehicle Status Changes
```javascript
supabase
  .channel('vehicles')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'vehicles',
    filter: 'id=eq.{vehicleId}'
  }, (payload) => {
    console.log('Vehicle updated!', payload)
  })
  .subscribe()
```

## Error Responses

```json
{
  "error": {
    "code": "number",
    "message": "string",
    "details": "string"
  }
}
```

Common Error Codes:
- 401: Unauthorized - Authentication required
- 403: Forbidden - Insufficient permissions
- 404: Not Found - Resource doesn't exist
- 409: Conflict - Resource already exists
- 422: Unprocessable Entity - Validation failed
- 429: Too Many Requests - Rate limit exceeded
- 500: Internal Server Error - Server-side error

## Rate Limits

- 100 requests per minute per IP
- 1000 requests per hour per user
- 10,000 requests per day per application

## Webhooks

Configure webhooks to receive notifications about specific events:

```http
POST /rest/v1/webhooks
```

Request Body:
```json
{
  "event_type": "vehicle.created|vehicle.updated|service.completed",
  "target_url": "https://your-server.com/webhook",
  "secret": "your_webhook_secret"
}
```

## Data Types

### Vehicle
```typescript
interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  notes?: string;
  status: 'active' | 'inactive' | 'maintenance' | 'sold';
  created_at: string;
  updated_at: string;
  owner_id: string;
  market_value?: number;
  mileage?: number;
  color?: string;
  features?: string[];
  last_service_date?: string;
}
```

### Inventory Item
```typescript
interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  location?: string;
  category?: string;
  price?: number;
  min_quantity?: number;
  supplier_id?: string;
  created_at: string;
  updated_at: string;
  barcode?: string;
  image_url?: string;
  description?: string;
  warranty_info?: string;
}
```

### Service Record
```typescript
interface ServiceRecord {
  id: string;
  vehicle_id: string;
  service_date: string;
  description: string;
  service_type: 'maintenance' | 'repair' | 'inspection' | 'modification';
  mileage?: number;
  cost: number;
  technician_id?: string;
  parts?: Part[];
  labor_hours: number;
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
  created_at: string;
  updated_at: string;
  notes?: string;
  warranty_info?: string;
}

interface Part {
  id: string;
  name: string;
  quantity: number;
  price: number;
  part_number?: string;
}
```

### User Profile
```typescript
interface Profile {
  id: string;
  full_name: string;
  avatar_url?: string;
  user_type: 'owner' | 'technician' | 'manager' | 'admin';
  bio?: string;
  achievements_count: number;
  reputation_score: number;
  skills?: Skill[];
  certifications?: Certification[];
  created_at: string;
  updated_at: string;
  social_links?: Record<string, string>;
  team_id?: string;
}

interface Skill {
  id: string;
  name: string;
  level: number;
  category: string;
}

interface Certification {
  id: string;
  name: string;
  issuer: string;
  date_earned: string;
  expiration_date?: string;
  credential_id?: string;
}
```
