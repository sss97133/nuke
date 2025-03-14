# Vehicle Timeline Testing Guide

This document provides steps for testing the Vehicle Timeline component integration in different environments.

## Local Testing Setup

1. Copy the environment template:
   ```bash
   cp .env.test.template .env.test
   ```

2. Edit `.env.test` to include your Supabase credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_SUPABASE_SERVICE_KEY=your-service-key
   NODE_ENV=test
   ```

3. Run the test script:
   ```bash
   npm run test:timeline
   ```

## Full Integration Setup

This will fix production assets, verify environment variables, and run the tests:

```bash
npm run setup:timeline
```

## Testing in CI/CD Environment

For testing in your GitHub Actions workflow, add the following step:

```yaml
- name: Test Vehicle Timeline
  run: npm run test:timeline
  env:
    VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
    VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
    VITE_SUPABASE_SERVICE_KEY: ${{ secrets.VITE_SUPABASE_SERVICE_KEY }}
```

## Manual Testing in Browser

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Navigate to: 
   - http://localhost:5173/vehicle-timeline
   - http://localhost:5173/vehicle/YOUR_TEST_VIN

## Database Migration 

The test script will attempt to create required tables if they don't exist. You can also manually run the migration:

1. Navigate to your Supabase dashboard
2. Go to SQL Editor
3. Copy contents from `migrations/vehicle_timeline.sql`
4. Run the SQL query

## Expected Test Results

When tests run successfully, you should see output similar to:

```
🧪 Starting Vehicle Timeline Component Tests
==========================================

🔍 Checking required files...
✅ Found: src/components/VehicleTimeline/index.tsx
✅ Found: src/components/VehicleTimeline/VehicleTimeline.css
✅ Found: src/pages/VehicleTimelinePage.tsx
✅ Found: src/pages/VehicleTimelinePage.css
✅ Found: migrations/vehicle_timeline.sql
✅ All required files are present

🔍 Checking database structure...
✅ vehicle_timeline_events table exists

🔍 Seeding test data...
✅ Test vehicle already exists
✅ Added timeline events for test vehicle

🔍 Testing component rendering...
✅ Created test component
✅ TypeScript compilation successful

🔍 Testing connector functionality...
✅ Successfully retrieved 3 timeline events

🔍 Cleaning up test data...
✅ Deleted test timeline events
✅ Deleted test vehicle

==========================================
✅ All tests passed! (5 tests)
```

If you encounter any failures, the test will indicate which specific checks failed.
