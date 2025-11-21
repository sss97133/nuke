# Nuke API Documentation

## Overview

The Nuke API is a Phoenix-based application that serves as the backend for the Nuke vehicle identity platform. It provides data access, business logic, and integrations for the frontend application.

## Context Map

The application is structured into several core contexts:

- **Vehicles**: Manages vehicle identity, timeline events, and images.
- **Pricing**: Handles valuation logic, market data, and price signals.
- **Ownership**: Manages user roles, permissions, and verification.
- **Verification**: Handles data validation and confidence scoring.
- **Analytics**: Processes system usage and performance metrics.

## API Contracts

### Vehicle Profile

**GET /api/vehicles/:id**

Returns the canonical vehicle profile.

**Response:**
```json
{
  "id": "uuid",
  "year": 2023,
  "make": "Ford",
  "model": "Bronco",
  "vin": "1F...",
  "timeline_events": [
    {
      "id": "uuid",
      "date": "2023-01-01",
      "type": "service",
      "description": "Oil change"
    }
  ]
}
```

### Valuation

**POST /api/valuation/analyze**

Triggers an AI valuation analysis for a vehicle.

**Request:**
```json
{
  "vehicle_id": "uuid"
}
```

**Response:**
```json
{
  "valuation_id": "uuid",
  "status": "processing"
}
```

## Integration Guidelines

- All API requests must include a valid Supabase auth token in the `Authorization` header.
- Errors are returned in a standardized JSON format: `{ "error": { "code": "code", "message": "message" } }`.

