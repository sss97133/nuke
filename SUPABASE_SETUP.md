# Supabase Integration Setup

This document provides a guide for setting up the Supabase integration for your project.

## Prerequisites

- A Supabase account and project
- Node.js version 18 or higher
- npm version 8 or higher

## Getting Started

### 1. Find Your Supabase Credentials

1. Log in to your [Supabase dashboard](https://app.supabase.io/)
2. Select your project
3. Go to **Project Settings** > **API**
4. You'll need three pieces of information:
   - **Project URL**: Located under "Project URL"
   - **anon/public key**: Under "Project API keys"
   - **service_role key**: Under "Project API keys" (for admin operations only)

### 2. Set Up Environment Variables

1. Copy `.env.example` to a new file called `.env.local` in the root of your project:

   ```bash
   cp .env.example .env.local
   ```

2. Fill in your Supabase details:

   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_SUPABASE_SERVICE_KEY=your-service-role-key
   ```

### 3. Test Your Connection

Run the connection test script to verify everything is working:

```bash
node scripts/check-supabase-connection.mjs
```

If successful, you'll see "✅ Successfully connected to Supabase!"

### 4. Use Supabase in Your Components

Import the client from our utility module:

```jsx
import { supabase } from '@/lib/supabase';

// Example query
const { data, error } = await supabase
  .from('your_table')
  .select('*')
  .limit(10);
```

## Available Utility Functions

Our implementation provides several helper functions:

- `uploadVehicleImages`: For uploading images to Supabase storage
- `getPublicUrl`: Get a public URL for a stored file
- `queryWithRetry`: Execute queries with automatic retry on failure
- `invokeFunction`: Call Supabase Edge Functions
- `handleDatabaseError`: Format database errors into user-friendly messages

## Common Issues and Solutions

### Connection Issues

If you encounter "Connection failed" errors:

1. Verify that your Supabase URL and keys are correct
2. Ensure your IP address is not restricted in Supabase settings
3. Check if you've added the necessary environment variables

### Authentication Issues

If authentication fails:

1. Make sure you're using the correct anon key
2. Verify that RLS (Row Level Security) policies are correctly set up
3. Check the browser console for detailed error messages

### Storage Access Problems

If you can't upload files:

1. Ensure your storage bucket exists in Supabase
2. Check that the bucket's RLS policies allow uploads
3. Verify that the file types and sizes are within allowed limits

## CI/CD Integration

For GitHub Actions integration, ensure these secrets are set in your repository:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` 
- `SUPABASE_SERVICE_KEY`

## Local Development with Supabase

For local development with Supabase:

1. Install the Supabase CLI if needed:
   ```bash
   npm install -g supabase
   ```

2. Start the local environment:
   ```bash
   supabase start
   ```

3. Update your `.env.local` with the local connection details.

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [supabase-js Client Library](https://supabase.com/docs/reference/javascript/introduction)
- [Supabase YouTube Channel](https://www.youtube.com/c/supabase)
