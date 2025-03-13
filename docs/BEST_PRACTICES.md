# Nuke Development Best Practices

This document outlines best practices for working with the Nuke codebase to ensure consistent quality and prevent common issues, particularly in CI/CD pipelines.

## Import Practices

### React Syntax Highlighter

When importing from `react-syntax-highlighter`, always use the CommonJS (CJS) path rather than the ESM-specific path:

```javascript
// ✅ CORRECT: Use CJS path
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';

// ❌ AVOID: ESM-specific path can cause issues in CI/CD
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
```

### General Import Best Practices

1. **Absolute Imports**: Use the configured path aliases for better maintainability:

   ```javascript
   // ✅ CORRECT
   import { Button } from "@/components/ui/button";
   
   // ❌ AVOID
   import { Button } from "../../../components/ui/button";
   ```

2. **Import Organization**: Group and organize imports consistently:

   ```javascript
   // React and libraries
   import React, { useState } from 'react';
   import { useQuery } from '@tanstack/react-query';
   
   // UI components
   import { Button } from '@/components/ui/button';
   import { Input } from '@/components/ui/input';
   
   // Utilities and hooks
   import { formatDate } from '@/utils/dates';
   import { useVehicle } from '@/hooks/useVehicle';
   
   // Types
   import type { Vehicle } from '@/types';
   ```

3. **Lazy Loading**: For large components, consider lazy loading:

   ```javascript
   const LargeComponent = React.lazy(() => import('@/components/LargeComponent'));
   
   // Then use with Suspense
   <React.Suspense fallback={<div>Loading...</div>}>
     <LargeComponent />
   </React.Suspense>
   ```

## CI/CD Compatibility

1. **Test Your Build Locally**: Before pushing changes, test with a clean build:

   ```bash
   npm run clean && npm ci && npm run build
   ```

2. **Environment Variables**: Don't rely on environment variables for builds unless specified in the CI configuration.

3. **Dependencies**: Always update both the dependency and its corresponding type definitions:

   ```bash
   npm install some-package @types/some-package
   ```

4. **ESM Compatibility**: Our project uses ESM modules. Ensure any added dependencies are compatible.

## Styling Guidelines

1. **TailwindCSS**: Use Tailwind's utility classes instead of custom CSS when possible:

   ```jsx
   // ✅ CORRECT
   <div className="flex items-center justify-between p-4 bg-white rounded-lg shadow">
   
   // ❌ AVOID
   <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', backgroundColor: 'white', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
   ```

2. **Theme Consistency**: Use the theme variables from our design system:

   ```jsx
   // ✅ CORRECT
   <div className="bg-primary text-primary-foreground">
   
   // ❌ AVOID
   <div className="bg-blue-500 text-white">
   ```

## Testing

1. **Component Tests**: Write tests for all new components:

   ```typescript
   import { render, screen } from '@testing-library/react';
   import { Button } from './Button';
   
   test('renders button with text', () => {
     render(<Button>Click me</Button>);
     expect(screen.getByText('Click me')).toBeInTheDocument();
   });
   ```

2. **Test Coverage**: Aim for at least 70% test coverage for new features.

## Performance Considerations

1. **Memoization**: Use React.memo, useMemo, and useCallback for expensive operations:

   ```jsx
   // Memoize expensive calculations
   const sortedData = useMemo(() => {
     return [...data].sort((a, b) => a.name.localeCompare(b.name));
   }, [data]);
   
   // Memoize callbacks
   const handleClick = useCallback(() => {
     // handle click
   }, [dependency]);
   ```

2. **Bundle Size**: Be mindful of adding large dependencies. Check the impact with:

   ```bash
   npm run analyze
   ```

## Contribution Workflow

1. Create a feature branch
2. Make your changes
3. Ensure tests pass locally
4. Create a pull request
5. Wait for CI/CD checks to pass
6. Request review
7. Address review comments
8. Merge once approved

By following these best practices, we'll maintain a high-quality codebase and reduce issues in our CI/CD pipeline.