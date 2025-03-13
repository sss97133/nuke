# Nuke

A revolutionary vehicle management platform that serves as the digital identity for vehicles and transforms automotive ownership, investment, and data validation.

## Vision

Nuke is not just a vehicle management system—it's a comprehensive platform that creates a digital mirror for every vehicle. We're building the ultimate repository of automotive data, where vehicles themselves become digital entities with their own histories, specifications, and economic potential.

### Core Purpose

Our platform serves as:

- A digital identity for individual vehicles
- A comprehensive vehicle history validated through multiple data sources
- A new economic model for automotive investment and ownership
- The ultimate data platform for all automotive recordkeeping

### Target Users

Our ecosystem is designed for:

- **Industry Professionals**: Mechanics, detailers, car salespeople, restoration specialists
- **Vehicle Owners**: From everyday drivers to collectors
- **Automotive Investors**: Who want to participate in vehicle ownership without full title
- **Automotive Enthusiasts**: DIY mechanics, car hobbyists, and collectors
- **The Vehicles Themselves**: As digital entities with their own profiles and data histories

## Current Status

Our CI/CD pipeline has been fixed with comprehensive updates to all GitHub Actions workflows:

- Fixed PATH configuration using GitHub-recommended $GITHUB_PATH approach
- Added proper permissions configuration
- Standardized dependency installation procedures
- Implemented direct executable calling with npx
- Added detailed error handling and diagnostics
- Added Docker integration with automated Docker Hub publishing
- Fixed database schema issues and added migration scripts

## Features

- Vehicle digital identity profiles
- Verified data collection from multiple sources
- Maintenance and modification history tracking
- Analytics dashboard and valuation tools
- Mobile-friendly UI
- Ownership and investment management

## Technology Stack

- React 19
- TypeScript
- Vite 6
- TailwindCSS
- Jotai for state management
- Supabase for backend
- Vercel for deployment
- Docker for containerization

## Development

### Standard Development

To run the project locally:

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Docker Development

For Docker-based development (recommended for consistent environments):

```bash
# Start development environment with hot reloading
docker compose up app-dev

# Or run production build locally
docker compose up app-prod
```

See [Docker Documentation](docs/DOCKER.md) for more details on Docker integration.

## Docker Images

Pre-built Docker images are available on Docker Hub:

```bash
docker pull yourdockerhubusername/nuke:latest
docker run -p 8080:80 yourdockerhubusername/nuke:latest
```

## Documentation

- [Architecture](ARCHITECTURE.md)
- [API Documentation](API.md)
- [Docker Integration](docs/DOCKER.md)
- [Contributing](CONTRIBUTING.md)
- [Vision & Strategy](docs/VISION.md)
- [Development Roadmap](docs/ROADMAP.md)
- [Founder Q&A](docs/FOUNDER_QA.md)

# Production environment config updated on Thu Mar 13 14:24:03 PDT 2025
