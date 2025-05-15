# Streamlined GitHub Actions Workflows

This directory contains a minimal set of GitHub Actions workflows for the Nuke platform. We've consolidated numerous workflows into three essential ones to reduce maintenance overhead and simplify the CI/CD pipeline.

## Core Workflows

### 1. `core-ci.yml`
- **Purpose**: Builds and validates the codebase on every push and pull request
- **Key Features**:
  - TypeScript type checking
  - Project build verification
  - Artifact generation
- **When it runs**: On push to main branch and on pull requests

### 2. `core-deploy.yml`
- **Purpose**: Deploys the application to Vercel
- **Key Features**:
  - Automated builds for production
  - Environment configuration
  - Production deployment for main branch
  - Preview deployments for other branches
- **When it runs**: On push to main branch and manual triggers

### 3. `core-security.yml`
- **Purpose**: Ensures code quality and security
- **Key Features**:
  - CodeQL analysis for JavaScript/TypeScript
  - Secret detection
  - Environment variable verification
- **When it runs**: On push to main branch, pull requests, and weekly schedule

## Migration from Previous Workflows

The new consolidated workflows replace multiple specialized workflows that had overlapping functionality:

1. **Replaced CI workflows**:
   - `ci.yml`, `build-only.yml`, `simple-build.yml`, `simple-ci.yml`, etc.

2. **Replaced deployment workflows**:
   - `deploy.yml`, `docker-deploy.yml`, etc.

3. **Replaced security workflows**:
   - `codeql.yml`, `secret-check.yml`, `verify-secrets.yml`, etc.

## Legacy Workflows

Legacy workflows are kept as reference but are disabled. To fully migrate:

1. Remove `.yml` extension from legacy workflows (e.g., rename to `.yml.disabled`)
2. Test the new core workflows thoroughly
3. Remove legacy workflows when confident in the new system

## Best Practices

- Avoid creating new specialized workflows
- Extend the core workflows if additional functionality is needed
- Maintain bare-bones approach - only add what's absolutely necessary

## Environment Variables

The following secrets are required for these workflows:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_SERVICE_KEY`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
