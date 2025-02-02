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

## Endpoints

### Vehicles

#### Get Vehicles
```http
GET /rest/v1/vehicles
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
    "notes": "string"
  }
]
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
  "notes": "string"
}
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
    "category": "string"
  }
]
```

### Service Tickets

#### Get Service Tickets
```http
GET /rest/v1/service_tickets
```

Response:
```json
[
  {
    "id": "uuid",
    "description": "string",
    "status": "string",
    "priority": "string",
    "vehicle_id": "uuid"
  }
]
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

## Real-time Subscriptions

### Service Tickets Updates
```javascript
supabase
  .channel('service_tickets')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'service_tickets'
  })
```

## Error Responses

```json
{
  "error": {
    "code": "number",
    "message": "string"
  }
}
```

## Rate Limits

- 100 requests per minute per IP
- 1000 requests per hour per user

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
}
```

### Service Ticket
```typescript
interface ServiceTicket {
  id: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  vehicle_id?: string;
}
```