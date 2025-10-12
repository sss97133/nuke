# Nuke API - Vehicle-Centric Elixir Server

An Elixir-based API server for the Nuke platform, implementing a comprehensive vehicle-centric architecture that maintains complete digital vehicle identities throughout their lifecycle.

## Architecture Overview

This API server is built on the foundational concept of vehicle-centric architecture, where:

- Vehicles are first-class digital entities with persistent identities
- Each vehicle maintains a complete digital profile regardless of ownership changes
- Information accumulates over time, building a comprehensive vehicle history

Core components include:

- **Vehicles**: Primary entities with detailed attributes and ownership tracking
- **Timeline Events**: Immutable history of all significant vehicle events with confidence scoring
- **Images**: Comprehensive visual documentation with categorization

## Integration with Supabase

The Elixir server is designed to integrate with Supabase for authentication, storage, and additional database features. The integration layer handles:

- JWT token verification
- API request proxying/forwarding
- CORS configuration for frontend applications

## Setup Instructions

### Prerequisites

- Elixir 1.14+
- Erlang/OTP 25+
- PostgreSQL 12+
- Supabase local development environment (optional for full functionality)

### Initial Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   mix deps.get
   ```
3. Configure the database in `config/dev.exs`
4. Create and migrate the database:
   ```bash
   mix ecto.setup
   ```

### Supabase Integration

To configure Supabase integration:

1. Ensure your Supabase instance is running (local or remote)
2. Set environment variables or update the configuration:
   ```bash
   export SUPABASE_URL="http://127.0.0.1:54321"  # For local development
   export SUPABASE_ANON_KEY="your-anon-key"
   export SUPABASE_JWT_SECRET="your-jwt-secret"
   ```

### Starting the Server

```bash
# Start the Phoenix server
mix phx.server

# Or in interactive mode
iex -S mix phx.server
```

The server will be available at [`localhost:4000`](http://localhost:4000).

## API Endpoints

### Vehicles

- `GET /api/vehicles` - List all vehicles
- `GET /api/vehicles/:id` - Get a specific vehicle
- `POST /api/vehicles` - Create a new vehicle (authenticated)
- `PUT /api/vehicles/:id` - Update a vehicle (authenticated)
- `DELETE /api/vehicles/:id` - Archive a vehicle (authenticated)

### Timeline Events

- `GET /api/vehicles/:vehicle_id/timeline` - List timeline events for a vehicle
- `GET /api/timeline/:id` - Get a specific timeline event
- `POST /api/vehicles/:vehicle_id/timeline` - Create a timeline event (authenticated)
- `POST /api/timeline/:id/verify` - Verify a timeline event (authenticated)

### Images

- `GET /api/vehicles/:vehicle_id/images` - List images for a vehicle
- `GET /api/images/:id` - Get a specific image
- `POST /api/vehicles/:vehicle_id/images` - Add an image to a vehicle (authenticated)
- `PUT /api/images/:id` - Update image metadata (authenticated)
- `POST /api/images/:id/set-primary` - Set an image as primary (authenticated)
- `DELETE /api/images/:id` - Delete an image (authenticated)

## Development

### Running Tests

```bash
mix test
```

### Database Migrations

```bash
# Create a new migration
mix ecto.gen.migration migration_name

# Run pending migrations
mix ecto.migrate

# Rollback the last migration
mix ecto.rollback
```

## Production Deployment

Refer to the [Phoenix deployment guides](https://hexdocs.pm/phoenix/deployment.html) for optimal production configurations.

## Learn More

  * Official website: https://www.phoenixframework.org/
  * Guides: https://hexdocs.pm/phoenix/overview.html
  * Docs: https://hexdocs.pm/phoenix
  * Forum: https://elixirforum.com/c/phoenix-forum
  * Source: https://github.com/phoenixframework/phoenix
