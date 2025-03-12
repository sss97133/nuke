# Nuke

Modern vehicle management platform with advanced features.

## Build Status

Our CI/CD pipeline has been fixed with comprehensive updates to all GitHub Actions workflows:

- Fixed PATH configuration using GitHub-recommended $GITHUB_PATH approach
- Added proper permissions configuration
- Standardized dependency installation procedures
- Implemented direct executable calling with npx
- Added detailed error handling and diagnostics
- Added Docker integration with automated Docker Hub publishing

## Features

- Vehicle tracking
- Maintenance scheduling
- Analytics dashboard
- Mobile-friendly UI

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
