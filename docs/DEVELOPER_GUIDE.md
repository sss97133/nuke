# Nuke Developer Guide

This guide covers key development practices, tools, and validation systems for the Nuke codebase.

## Table of Contents

- [Development Environment Setup](#development-environment-setup)
- [Code Quality Tools](#code-quality-tools)
- [Database Interaction Best Practices](#database-interaction-best-practices)
- [Build Process and Deployment](#build-process-and-deployment)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)

## Development Environment Setup

### Prerequisites

- Node.js 18+ (20.x recommended)
- npm 8+
- Supabase CLI (for local database development)
- Docker (optional, for containerized development)

### Getting Started

1. Clone the repository:

```bash
git clone https://github.com/sss97133/nuke.git
cd nuke
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Create a `.env` file at the root of the project with the following variables:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_SERVICE_KEY=your_supabase_service_key
VITE_ENV=development
```

4. Start the development server:

```bash
npm run dev
```

## Code Quality Tools

Nuke uses several automated code quality tools to ensure consistent, robust code.

### Pre-commit Hooks

Pre-commit hooks run automatically when you commit code. These include:

- **Linting**: Ensures code follows style guidelines
- **Formatting**: Automatically formats code with Prettier
- **Query Validation**: Checks for common Supabase query issues

To manually run these checks:

```bash
# Run TypeScript type checking
npm run type-check

# Run ESLint
npm run lint

# Run Supabase query validation
npm run lint:queries

# Run all validators
npm run validate:all
```

### Database Schema Validation

The project includes a schema validation tool that checks your database structure against the expected schema:

```bash
npm run validate:schema
```

This helps catch database/code mismatches early in the development cycle.

## Database Interaction Best Practices

### Using Supabase Safely

When writing Supabase queries, follow these guidelines to avoid common issues:

1. **Always use TypeScript types for database operations**:

```typescript
import type { Database } from '../types';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL, 
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Query with type safety
const { data, error } = await supabase
  .from('team_members')
  .select('id, profile_id, status')
  .eq('status', 'active');
```

2. **Avoid multiple `from()` calls in a single chain**:

❌ **Incorrect**:
```typescript
// This will fail - multiple from() calls
const { data, error } = await supabase
  .from('team_members')
  .select('id')
  .from('profiles')  // This breaks the query!
  .select('email');
```

✅ **Correct**:
```typescript
// Separate queries for different tables
const { data: teamMembers } = await supabase
  .from('team_members')
  .select('id');

const { data: profiles } = await supabase
  .from('profiles')
  .select('email');
```

3. **Always handle query errors**:

```typescript
const { data, error } = await supabase
  .from('team_members')
  .select('id, status');

if (error) {
  console.error('Database query failed:', error);
  // Handle the error appropriately
  return;
}

// Now safe to use data
console.log(`Found ${data.length} team members`);
```

### Database Migrations

When creating database migrations:

1. Use the safe utility functions in `supabase/migrations/00000000000000_schema_safety_utilities.sql`:

```sql
-- Example: Safely add a column
SELECT safely_add_column('public', 'team_members', 'status', 'TEXT', '''active''');

-- Example: Safely update values
SELECT safely_update_column_values('public', 'team_members', 'status', '''active''', 'status IS NULL');
```

2. Follow the migration naming convention:
   - Timestamp prefix: `YYYYMMDD_description.sql`
   - Descriptive name: `20250313_add_status_to_team_members.sql`

3. Test migrations locally before pushing:
   ```bash
   supabase db reset
   ```

## Build Process and Deployment

Nuke uses a multi-stage CI/CD pipeline:

1. **Security Checks**: Detect sensitive data and run code scanning
2. **Code Quality**: Run linting, type checking, and query validation
3. **Build and Test**: Compile the project and run tests
4. **Deployment**: Deploy to Vercel (production only on main branch)

### Understanding Build Failures

If a build fails, check the GitHub Actions logs. Common issues include:

- **Import path issues**: Make sure to use CJS paths for libraries like `react-syntax-highlighter`:
  ```typescript
  // Use this:
  import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
  
  // Not this:
  import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
  ```

- **Database query errors**: Check for malformed queries or schema mismatches
- **Type errors**: Ensure type definitions match your component usage

## Troubleshooting Common Issues

### "Cannot find module" errors

If you encounter a "Cannot find module" error during build:

1. Check if the package is listed in `package.json`
2. Verify import paths (especially for ESM/CJS specific imports)
3. Try clearing your node_modules cache and reinstalling:
   ```bash
   npm run clean
   npm install
   ```

### Database-related errors

#### "Column does not exist" errors

If your query fails with a "column does not exist" error:

1. Check if the column exists in your database schema
2. Verify the column name in your TypeScript types
3. Consider adding a migration to create the missing column:
   ```sql
   -- In a new migration file
   SELECT safely_add_column('public', 'your_table', 'missing_column', 'TEXT');
   ```

4. Run the schema validation tool to catch similar issues:
   ```bash
   npm run validate:schema
   ```

#### "Invalid query" errors

If you see "Invalid query" errors from Supabase:

1. Check for malformed query chains (like multiple `.from()` calls)
2. Validate your filter conditions
3. Run the query validator to catch common mistakes:
   ```bash
   npm run lint:queries
   ```

### React and UI errors

#### Components not rendering as expected

If components aren't rendering correctly:

1. Check for React key warnings in the console
2. Verify that component props match expected types
3. Ensure CSS modules are correctly imported

#### State management issues

For Jotai state issues:

1. Verify atom definitions are consistent
2. Check for circular dependencies between atoms
3. Ensure atoms are initialized with the correct default values

## Advanced Topics

### Working with the Agent System

The agent system is a core part of Nuke's architecture:

1. **Agent Database Schema**:
   - Agents have their own tables in the database
   - Use proper relationships between agents and other entities

2. **Agent Implementation**:
   - Follow the agent protocol defined in the documentation
   - Use typed interfaces for all agent interactions

3. **Testing Agents**:
   - Use mock agents for testing
   - Validate agent behavior with integration tests

### Performance Optimization

For optimal performance:

1. **Bundle Size Management**:
   - Leverage code splitting where appropriate
   - Use dynamic imports for large dependencies
   - Monitor bundle sizes with build analytics

2. **Rendering Optimization**:
   - Use memoization for expensive computations
   - Implement virtualization for large lists
   - Profile component renders with React DevTools

### Accessibility

Maintain accessibility standards:

1. **ARIA Attributes**:
   - Use proper ARIA roles and attributes
   - Test with screen readers

2. **Keyboard Navigation**:
   - Ensure all interactive elements are keyboard accessible
   - Implement focus management for modal dialogs

3. **Color Contrast**:
   - Maintain WCAG 2.1 AA standard contrast ratios
   - Test with color contrast analyzers

## Contributing

Before submitting a pull request:

1. Run all validations:
   ```bash
   npm run validate:all
   ```

2. Write tests for new features and bug fixes
3. Update documentation to reflect changes
4. Ensure your branch is up to date with main
5. Follow conventional commit message format

Remember, the pre-commit hooks and CI pipeline are designed to catch issues early. If you encounter failures, use them as opportunities to fix problems before they affect other developers or users.
