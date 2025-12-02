# Database Migration Guide - STOP FUCKING UP

## Prerequisites
You need the database password for migrations to work. The Supabase CLI needs to connect to the remote database.

## The Correct Way to Run Migrations

1. **For remote database push (production)**:
   ```bash
   # You need the DB password! Ask the user if you don't have it
   # The error "Wrong password" means you need the actual database password
   npx supabase db push --db-url "postgresql://postgres.[PROJECT_REF]:[DB_PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
   ```

2. **For local development**:
   ```bash
   # This works without password
   npx supabase db push --local
   ```

## What We Have
- **Project Reference**: qkgaybvrernstplzjaam (from .env.supabase)
- **Project URL**: https://qkgaybvrernstplzjaam.supabase.co
- **Access Token**: <your_supabase_access_token>

## What We DON'T Have (and need for remote migrations)
- **DATABASE PASSWORD** - This is different from the service role key or JWT secret!

## Common Errors
- `Wrong password` = You need the actual database password, not the service role key
- `failed SASL auth` = Same as above - wrong or missing password

## Alternative: Use Supabase Dashboard
If you can't run migrations via CLI, you can:
1. Go to https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
2. Run the SQL migration directly in the SQL editor
3. This uses web auth instead of DB password

## Stop Making These Mistakes
1. DON'T try to run `npx supabase db push` without the database password
2. DON'T confuse service_role_key with database password - they're different
3. DON'T keep trying the same command that fails with "Wrong password"
4. DO ask the user for the database password when needed
5. DO use the SQL editor in Supabase dashboard as an alternative

## For This Specific Migration (Brand Logos)
Since we can't push via CLI without the password, here's what to do:
1. Tell the user to go to: https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/sql
2. Give them the migration SQL to run directly
3. OR ask for the database password so we can push properly
