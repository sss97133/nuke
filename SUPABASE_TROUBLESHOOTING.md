# Supabase Local Development Troubleshooting Guide

## Quick Fixes for Common Issues

### "Supabase is running" but no containers appear

**Problem**: The CLI reports success (`supabase local development setup is running`) but when you run `docker ps`, no Supabase containers are visible.

**Quick Fix**:
1. Check for port conflicts:
   ```bash
   # See if ports 54321-54324 are being used
   lsof -i :54321-54324
   ```
2. If you see any services using these ports, stop them:
   ```bash
   # Example if a custom postgres container is running
   docker stop container_name
   ```
3. Restart Supabase:
   ```bash
   supabase stop
   supabase start
   ```

### Login/Authentication Not Working

**Problem**: You can't log in, or you're getting 500 Internal Server errors with authentication.

**Quick Fix**:
1. Verify Supabase containers are actually running:
   ```bash
   docker ps | grep supabase
   ```
2. Check the auth service health:
   ```bash
   curl http://localhost:54321/auth/v1/health
   ```
3. If auth service isn't responding, restart Supabase:
   ```bash
   supabase stop
   supabase start
   ```

## Complete Reset Procedure

If you're having persistent issues, follow these steps for a complete reset:

1. Stop Supabase and remove volumes:
   ```bash
   supabase stop
   docker system prune --volumes  # WARNING: This removes ALL unused Docker volumes
   ```

2. Stop and reset Docker (if needed):
   - Open Docker Desktop
   - Go to Settings/Troubleshooting
   - Click "Reset to factory defaults"

3. Check for port conflicts before starting:
   ```bash
   lsof -i :54321-54324
   ```

4. Start Supabase with a clean slate:
   ```bash
   supabase start
   ```

5. Verify all services are running:
   ```bash
   docker ps | grep supabase
   ```

## How Supabase Works Locally

- Supabase spins up multiple Docker containers on these ports:
  - 54321: API Gateway (auth, REST, etc.)
  - 54322: PostgreSQL Database
  - 54323: Supabase Studio UI
  - 54324: Mailhog (email testing)

- If any of these ports are in use, Supabase will fail to start properly

## Common Mistakes to Avoid

1. **Running your own Postgres on port 54322**: This causes a conflict with Supabase's database container
2. **Not checking Docker container status**: Always verify with `docker ps` that containers are actually running
3. **Assuming the CLI is reporting accurately**: The CLI might report success even when container startup fails

## Helpful Diagnostics

When troubleshooting, always run these commands:

```bash
# Check if containers are running
docker ps

# Check Supabase API health
curl http://localhost:54321/auth/v1/health

# Check if ports are in use
lsof -i :54321-54324

# Get logs from specific containers if needed
docker logs supabase_auth_XXXXXXXXXXXX
```
