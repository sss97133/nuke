# Docker Integration with Nuke

This document explains how Docker is integrated with the Nuke project and GitHub Actions.

## Overview

Docker is used in two primary ways in the Nuke project:

1. **Local Development**: Using Docker Compose for consistent development environments
2. **CI/CD**: Using Docker in GitHub Actions for building, testing, and deploying the application

## Docker Configuration Files

- `Dockerfile`: Defines the production container image for Nuke
- `docker-compose.yml`: Multi-container setup for local development

## Using Docker for Local Development

### Prerequisites

- Docker Desktop installed on your machine
- Docker Compose installed (comes with Docker Desktop)

### Starting Development Environment

```bash
# Start the development server with hot reloading
docker compose up app-dev

# Or start the production build for testing
docker compose up app-prod
```

### Stopping the Environment

```bash
docker compose down
```

## Docker in GitHub Actions

### How It Works

1. GitHub Actions uses Docker in two ways:
   - **Container-based Actions**: Running workflows inside Docker containers
   - **Docker Build/Push**: Building Docker images and pushing to registries

2. The workflow files that use Docker:
   - `.github/workflows/docker-deploy.yml`: Builds and optionally deploys the Docker image
   - `.github/workflows/docker-build.yml`: Tests building the application in a Docker container
   - `.github/workflows/docker-simple.yml`: Simplified Docker-based build for debugging

### GitHub Actions Docker Integration

GitHub Actions can run entire workflows in Docker containers, which provides:

- Consistent build environments
- Isolation from the host runner
- Pre-configured environments with necessary dependencies

Example from our workflow:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: node:18-alpine
    
    steps:
      # Actions run inside the specified container
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Build
        run: npm ci && npm run build
```

## Setting up Docker Registry Integration

To push Docker images to a registry (Docker Hub or GitHub Container Registry), you need to:

1. Set up secrets in your GitHub repository:
   - For Docker Hub: `DOCKER_HUB_USERNAME` and `DOCKER_HUB_TOKEN`
   - For GitHub Container Registry: Uses `GITHUB_TOKEN` automatically

2. Uncomment the relevant sections in `.github/workflows/docker-deploy.yml`

## Troubleshooting

### Common Issues

1. **Build failures in GitHub Actions**:
   - Check if the Docker image has all required dependencies
   - Ensure proper environment variables are set

2. **Local Docker Compose issues**:
   - Make sure ports aren't already in use
   - Check volume mounts are correct

3. **Docker Registry push failures**:
   - Verify authentication credentials
   - Check if you have permission to push to the registry

### Debugging Tips

- Run the Docker build locally: `docker build -t nuke:test .`
- Check logs with: `docker compose logs app-dev`
- Inspect running containers: `docker ps`
