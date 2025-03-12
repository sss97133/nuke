# Docker Integration with Nuke

This document explains how Docker is integrated with the Nuke project and GitHub Actions.

## Overview

Docker is used in two primary ways in the Nuke project:

1. **Local Development**: Using Docker Compose for consistent development environments
2. **CI/CD**: Using Docker in GitHub Actions for building, testing, and deploying the application to Docker Hub

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
   - **Docker Build/Push**: Building Docker images and pushing to Docker Hub

2. The workflow files that use Docker:
   - `.github/workflows/docker-deploy.yml`: Builds and pushes the Docker image to Docker Hub
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
      image: node:18-alpine  # This runs the entire job in a Node.js container
    
    steps:
      # Actions run inside the specified container
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Build
        run: npm ci && npm run build
```

## Docker Hub Integration

The Nuke project is set up to automatically build and push Docker images to Docker Hub.

### How It Works

1. When you push to the `main` branch, the workflow:
   - Builds a Docker image
   - Logs into Docker Hub using your credentials stored as GitHub Secrets
   - Pushes the image with two tags:
     - `latest`: Always the most recent build
     - `<commit-sha>`: A unique tag for each build for versioning

2. Images are available at: `your-dockerhub-username/nuke`

### Setting up Docker Hub Secrets

To connect GitHub to Docker Hub, you need to set up the following secrets in your GitHub repository:

1. Go to your repository settings: `https://github.com/sss97133/nuke/settings/secrets/actions`
2. Add these secrets:
   - `DOCKER_HUB_USERNAME`: Your Docker Hub username
   - `DOCKER_HUB_TOKEN`: Your Docker Hub access token (not your password)

### Creating a Docker Hub Access Token

For security, use access tokens instead of your password:

1. Log in to Docker Hub: https://hub.docker.com
2. Go to your account settings
3. Click on "Security" > "New Access Token"
4. Give the token a name (e.g., "GitHub Actions")
5. Copy the generated token and add it to GitHub Secrets

## Using the Published Docker Images

Once your images are published to Docker Hub, you can use them in various environments:

```bash
# Pull the latest image
docker pull yourusername/nuke:latest

# Run the container
docker run -p 8080:80 yourusername/nuke:latest
```

## Troubleshooting

### Common Issues

1. **Build failures in GitHub Actions**:
   - Check if the Docker image has all required dependencies
   - Ensure proper environment variables are set

2. **Docker Hub authentication failures**:
   - Verify your Docker Hub credentials are correct in GitHub Secrets
   - Make sure the access token has push permissions

3. **Local Docker Compose issues**:
   - Make sure ports aren't already in use
   - Check volume mounts are correct

### Debugging Tips

- Run the Docker build locally: `docker build -t nuke:test .`
- Check logs with: `docker compose logs app-dev`
- Inspect running containers: `docker ps`
