# API Documentation

## Overview

This document outlines the API endpoints and data structures used in the Technical Asset Management System (TAMS).

## Authentication

All API requests require authentication using Supabase JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### Vehicles

#### GET /vehicles
Retrieves a list of vehicles.

#### POST /vehicles
Creates a new vehicle entry.

Request body:
```json
{
  "make": "string",
  "model": "string",
  "year": "number",
  "vin": "string"
}
```

### Inventory

#### GET /inventory
Retrieves inventory items.

#### POST /inventory
Creates a new inventory item.

### Service Tickets

#### GET /service-tickets
Retrieves service tickets.

#### POST /service-tickets
Creates a new service ticket.

## Error Handling

The API uses standard HTTP status codes:
- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

## Rate Limiting

API requests are limited to 100 requests per minute per user.