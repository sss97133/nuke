# Nuke Vehicle-Centric Platform

The Nuke platform is a comprehensive vehicle-centric application that maintains complete digital identities for vehicles throughout their lifecycle. The platform treats vehicles as first-class digital entities and maintains an immutable history using a timeline-based event aggregation system.

## Project Structure

This project consists of two main components:

1. `nuke_api` - The backend API built with Elixir and Phoenix, providing vehicle-centric endpoints
2. `nuke_frontend` - The frontend React application built with Vite, TypeScript, and Tailwind CSS

## Key Features

- **Vehicle Management**: Create, update, and view vehicle profiles with comprehensive details
- **Timeline Events**: Record immutable history of vehicle events with confidence scoring
- **Image Management**: Upload and organize vehicle images with metadata and categorization
- **Authentication**: Secure user authentication via Supabase
- **API Integration**: Seamless communication between frontend and backend

## Getting Started

### Prerequisites

- Elixir 1.14+
- Phoenix 1.7+
- Node.js 16+
- PostgreSQL 14+
- Supabase Local Development setup

### Environment Setup

#### Backend (nuke_api)

1. Navigate to the API directory
   ```bash
   cd nuke_api
   ```

2. Install dependencies
   ```bash
   mix deps.get
   ```

3. Set up the database
   ```bash
   mix ecto.setup
   ```

4. Update Supabase configuration in `config/dev.exs` if needed
   ```elixir
   config :nuke_api, supabase_url: "http://127.0.0.1:54321"
   config :nuke_api, supabase_anon_key: "your-anon-key"
   config :nuke_api, supabase_jwt_secret: "your-jwt-secret"
   ```

5. Start the Phoenix server
   ```bash
   mix phx.server
   ```

#### Frontend (nuke_frontend)

1. Navigate to the frontend directory
   ```bash
   cd nuke_frontend
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Set up environment variables in `.env` file
   ```
   VITE_API_URL=http://localhost:4000/api
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

4. Start the development server
   ```bash
   npm run dev
   ```

## API Endpoints

The API follows RESTful principles with a vehicle-centric architecture:

### Vehicles

- `GET /api/vehicles` - List all vehicles
- `GET /api/vehicles/:id` - Get a specific vehicle
- `POST /api/vehicles` - Create a new vehicle
- `PUT /api/vehicles/:id` - Update a vehicle
- `DELETE /api/vehicles/:id` - Archive a vehicle (not actually deleted, following vehicle-centric principles)

### Timeline Events

- `GET /api/vehicles/:vehicle_id/timeline` - List timeline events for a vehicle
- `GET /api/timeline/:id` - Get a specific timeline event
- `POST /api/vehicles/:vehicle_id/timeline` - Create a timeline event
- `POST /api/timeline/:id/verify` - Verify a timeline event

### Images

- `GET /api/vehicles/:vehicle_id/images` - List images for a vehicle
- `GET /api/images/:id` - Get a specific image
- `POST /api/vehicles/:vehicle_id/images` - Upload a new image
- `POST /api/vehicles/:vehicle_id/images/:id/primary` - Set an image as primary
- `POST /api/images/:id/verify` - Verify an image

## Working with Supabase Locally

Supabase uses ports 54321-54324 for local development. If you encounter issues:

1. Check if containers are running:
   ```bash
   docker ps | grep supabase
   ```

2. Check for port conflicts:
   ```bash
   lsof -i :54321-54324
   ```

3. Verify auth service health:
   ```bash
   curl http://localhost:54321/auth/v1/health
   ```

4. If needed, restart Supabase:
   ```bash
   supabase stop && supabase start
   ```

## Best Practices

1. Always use real vehicle data instead of mock data, even for testing
2. Treat vehicles as first-class entities with ownership tracking
3. Timeline events are immutable and represent the complete vehicle history
4. All significant vehicle changes should create a new timeline event
5. Image uploads should include proper categorization and metadata
6. Data validation should be performed on both frontend and backend

## Project Design Philosophy

The Nuke platform implements a vehicle-centric data architecture with:

1. Digital Identity Components:
   - Timeline-based event aggregation for complete vehicle history
   - Immutable record-keeping through timeline events
   - Multi-source data aggregation with confidence scoring
   - Ownership tracking with both traditional and fractional capabilities

2. Trust Mechanisms:
   - Professional verification systems
   - Multi-angle documentation
   - Confidence scoring for resolving conflicting information

This approach differs fundamentally from transaction-focused platforms, treating the vehicle itself as the unit of value around which all other platform elements are organized.
