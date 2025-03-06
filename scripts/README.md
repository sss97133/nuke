# User Management Scripts

This directory contains scripts for managing users in the application.

## Available Scripts

### Create Test Users

Creates multiple test users for testing purposes.

```bash
# Make the script executable (first time only)
chmod +x scripts/run-create-users.sh

# Run the script
./scripts/run-create-users.sh
```

This will create several test users with predefined credentials that you can use for testing.

### Make a User an Admin

Promotes an existing user to admin status.

```bash
# Make the script executable (first time only)
chmod +x scripts/make-admin.sh

# Run the script with a user's email
./scripts/make-admin.sh user@example.com
```

This will update the user's metadata to include admin privileges.

## Admin Panel

The application also includes a web-based admin panel that you can access at `/admin` after logging in with an admin account. The admin panel provides a user interface for:

- Creating test users
- Viewing existing users
- Deleting users
- Managing system settings (coming soon)
- Viewing system logs (coming soon)

## Requirements

These scripts require:

1. Node.js to be installed
2. Access to your Supabase project
3. Proper environment variables set in a `.env` file:
   - `SUPABASE_URL`: Your Supabase project URL
   - `SUPABASE_ANON_KEY`: Your Supabase anonymous key

## Security Notes

- The admin panel is protected and only accessible to users with admin privileges
- Admin privileges are stored in user metadata
- These scripts should not be used in production environments without proper security considerations
- Be careful when creating admin users, as they have elevated privileges in the application 