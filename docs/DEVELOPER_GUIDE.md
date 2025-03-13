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

### "Cannot find column 'status' in table 'team_members'"

This error occurs when your code is trying to query a column that doesn't exist in the database.

**Solution**:
1. Check if the column exists in your local database schema
2. Run the appropriate migration to add the column:
   ```sql
   ALTER TABLE team_members ADD COLUMN status TEXT DEFAULT 'active';
   ```
3. Update your types file to include the new column

### "Rollup failed to resolve import"

This build error happens when the build system can't resolve a module import path.

**Solution**:
1. Check that the module is installed in `package.json`
2. Ensure the import path is using the correct format (CJS vs ESM)
3. For `react-syntax-highlighter`, always use the CJS path:
   ```typescript
   import { PrismLight } from 'react-syntax-highlighter';
   import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';
   ```

### "Multiple .from() calls in the same query chain"

This error from the query validator indicates a malformed Supabase query.

**Solution**:
1. Split the query into separate chains for each table
2. If you need to join tables, use the `select` method with join syntax:
   ```typescript
   const { data, error } = await supabase
     .from('team_members')
     .select(`
       id,
       status,
       profiles (id, email)
     `);
   ```

## Agent System

The Nuke platform includes an agent system for automating various tasks. This section covers how to work with the agent architecture.

### Agent Architecture Overview

The agent system consists of:

1. **Agent Definitions**: Core logic for each agent type
2. **Agent Runners**: Execution environment for agents
3. **Agent Tasks**: Individual tasks that agents can perform
4. **Agent Data Store**: Persistent storage for agent state

### Working with Agents

To create a new agent:

1. Define the agent type in `src/agents/types.ts`
2. Create the agent implementation in `src/agents/[agent-name]/index.ts`
3. Register the agent in `src/agents/registry.ts`

Example agent implementation:

```typescript
// src/agents/vehicle-monitor/index.ts
import { Agent, AgentContext } from '../types';

export class VehicleMonitorAgent implements Agent {
  id: string;
  type = 'vehicle-monitor';
  
  constructor(id: string) {
    this.id = id;
  }
  
  async run(context: AgentContext) {
    // Agent implementation goes here
    const { data, error } = await context.supabase
      .from('vehicles')
      .select('*')
      .eq('status', 'active');
      
    if (error) {
      context.logger.error('Failed to fetch vehicles', error);
      return;
    }
    
    // Process vehicles
    for (const vehicle of data) {
      await this.processVehicle(vehicle, context);
    }
  }
  
  private async processVehicle(vehicle, context) {
    // Vehicle-specific logic
  }
}
```

### Testing Agents

Agents should have thorough test coverage:

```typescript
// src/agents/vehicle-monitor/index.test.ts
import { VehicleMonitorAgent } from './index';
import { createMockContext } from '../testing';

describe('VehicleMonitorAgent', () => {
  it('should process active vehicles', async () => {
    // Setup
    const mockContext = createMockContext({
      supabase: {
        from: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({
          data: [{ id: 'v1', vin: 'ABC123', status: 'active' }],
          error: null
        })
      }
    });
    
    const agent = new VehicleMonitorAgent('test-agent');
    
    // Execute
    await agent.run(mockContext);
    
    // Assert
    expect(mockContext.supabase.from).toHaveBeenCalledWith('vehicles');
    expect(mockContext.supabase.eq).toHaveBeenCalledWith('status', 'active');
  });
});
```

## Pull Request Process

When submitting changes to the Nuke codebase, follow these steps:

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and commit them with descriptive messages:
   ```bash
   git commit -m "Feature: Add detailed description of your change"
   ```

3. **Run validation** before pushing:
   ```bash
   npm run validate:all
   ```

4. **Push your branch** and create a pull request:
   ```bash
   git push -u origin feature/your-feature-name
   ```

5. **Fill out the PR template** with:
   - What problem are you solving?
   - How did you solve it?
   - What changes did you make?
   - How can reviewers test your changes?

6. **Address review feedback** and wait for CI checks to pass

7. **Merge** when approved (squash and merge preferred)

## Resources and Documentation

- [Supabase Documentation](https://supabase.io/docs)
- [React 19 Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Vite Documentation](https://vitejs.dev/guide/)
- [Jotai Documentation](https://jotai.org/docs/introduction)

## Getting Help

If you encounter issues not covered in this guide, you can:

1. Check existing GitHub issues to see if your problem is already reported
2. Ask in the team Slack channel (#nuke-development)
3. Create a new GitHub issue with details about the problem

## Contributing to This Guide

This guide is a living document. If you find areas that need more detail or discover new issues and solutions, please contribute by:

1. Creating a PR to update this file
2. Adding new sections for common issues
3. Improving examples and explanations
