# Nuke Platform

A comprehensive vehicle identity management system designed for automotive industry professionals, collectors, and verification services.

## Overview

Nuke provides a vehicle-centric digital platform that maintains complete historical records throughout a vehicle's lifecycle. The system aggregates data from multiple sources to create immutable timelines with professional verification and trust mechanisms.

## Architecture

### System Components

- **Backend API**: Elixir/Phoenix application with PostgreSQL database
- **Frontend Application**: React/TypeScript single-page application
- **Database Layer**: Supabase integration with Row Level Security
- **Timeline System**: Event aggregation with temporal data management
- **Image Pipeline**: Multi-resolution optimization with EXIF metadata extraction

### Technical Stack

**Backend:**
- Elixir 1.15+ with Phoenix Framework
- PostgreSQL 14+ with JSONB support
- Supabase for authentication and real-time features

**Frontend:**
- React 18+ with TypeScript
- Vite build system
- Tailwind CSS for styling
- Custom component library

## Getting Started

### Prerequisites

- Node.js 18+
- Elixir 1.15+
- PostgreSQL 14+
- Supabase CLI (optional)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd nuke
   ```

2. **Install frontend dependencies**
   ```bash
   cd nuke_frontend
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   cd ../nuke_api
   mix deps.get
   ```

4. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

### Development

**Start the backend server:**
```bash
cd nuke_api
mix phx.server
```

**Start the frontend development server:**
```bash
cd nuke_frontend
npm run dev
```

The application will be available at `http://localhost:5174`

## Core Features

### Vehicle Management
- Complete vehicle lifecycle tracking
- Multi-source data aggregation
- Professional verification workflow
- Immutable historical records

### Timeline System
- Event-driven architecture
- Temporal data management
- Confidence scoring
- Multi-participant records

### Image Pipeline
- Multi-resolution optimization
- EXIF metadata extraction
- Automatic variant generation
- Performance-optimized delivery

### User Management
- Role-based access control
- Professional verification
- Contribution tracking
- Activity monitoring

## API Documentation

### Vehicle Endpoints

```
GET    /api/vehicles           # List vehicles
POST   /api/vehicles           # Create vehicle
GET    /api/vehicles/:id       # Get vehicle details
PUT    /api/vehicles/:id       # Update vehicle
DELETE /api/vehicles/:id       # Delete vehicle
```

### Timeline Endpoints

```
GET    /api/vehicles/:id/timeline      # Get vehicle timeline
POST   /api/vehicles/:id/events        # Create timeline event
PUT    /api/timeline-events/:id        # Update event
DELETE /api/timeline-events/:id        # Delete event
```

### Image Endpoints

```
POST   /api/vehicles/:id/images        # Upload image
GET    /api/vehicles/:id/images        # List images
DELETE /api/images/:id                 # Delete image
```

## Database Schema

### Core Tables

- `vehicles`: Primary vehicle records
- `timeline_events`: Historical event records
- `vehicle_images`: Image storage and metadata
- `profiles`: User profile management
- `verifications`: Professional verification records

See `docs/schema.md` for complete database documentation.

## Performance

### Optimization Features

- **Image Pipeline**: 300x improvement in thumbnail loading (10KB vs 3MB)
- **Component Architecture**: Modular design for optimal bundle splitting
- **Database Indexing**: Optimized queries for timeline and search operations
- **Caching**: Strategic caching for frequently accessed data

### Monitoring

- Application performance monitoring
- Database query optimization
- Error tracking and alerting
- User experience metrics

## Security

### Authentication
- Supabase Auth integration
- JWT token management
- Role-based access control

### Data Protection
- Row Level Security policies
- Input validation and sanitization
- Secure file upload handling
- API rate limiting

## Testing

**Run frontend tests:**
```bash
cd nuke_frontend
npm test
```

**Run backend tests:**
```bash
cd nuke_api
mix test
```

## Deployment

### Production Configuration

1. Set production environment variables
2. Build frontend assets: `npm run build`
3. Run database migrations: `mix ecto.migrate`
4. Start production server: `mix phx.server`

### Environment Variables

Required configuration:
- `DATABASE_URL`: PostgreSQL connection string
- `SECRET_KEY_BASE`: Phoenix secret key
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_ANON_KEY`: Supabase anonymous key

## Contributing

### Development Workflow

1. Create feature branch from `main`
2. Implement changes with tests
3. Ensure all tests pass
4. Submit pull request with description

### Code Standards

- TypeScript for frontend development
- Elixir/Phoenix conventions for backend
- Comprehensive test coverage
- Documentation for public APIs

## Support

For technical support and questions:
- Review documentation in `docs/` directory
- Check existing issues in the repository
- Contact the development team

---

**License**: Private - All rights reserved