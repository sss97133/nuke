# Deployment & Change Shipping Workflow

**Last Updated:** January 25, 2025  
**Status:** Active Production Workflow

## Overview

This document outlines the standard workflow for implementing, testing, and deploying changes to the n-zero platform. This process ensures all changes are properly tested, committed, and deployed to production.

## Standard Workflow

### 1. Implementation Phase

1. **Read and Understand Requirements**
   - Review user request carefully
   - Identify affected files and components
   - Check existing code patterns and conventions

2. **Make Code Changes**
   - Edit files using appropriate tools (`search_replace`, `write`, etc.)
   - Follow existing code style and patterns
   - Ensure TypeScript types are correct
   - No emojis in code (per user preference)

3. **Check for Errors**
   - Run `read_lints` on modified files
   - Fix any TypeScript/ESLint errors immediately
   - Ensure imports are correct

### 2. Local Verification

```bash
# Build locally to catch errors before deployment
cd nuke_frontend && npm run build
```

**Critical:** Never deploy if local build fails. Fix errors first.

### 3. Git Workflow

```bash
# Stage all changes
git add -A

# Commit with descriptive message
git commit -m "Brief description of changes

- Specific change 1
- Specific change 2
- Any important notes"

# Push to GitHub
git push origin main
```

**Commit Message Guidelines:**
- First line: Brief summary (50 chars or less)
- Blank line
- Bullet points for specific changes
- Reference issue numbers if applicable

### 4. Deployment to Production

```bash
# Deploy to Vercel production
vercel --prod --force --yes
```

**Important Notes:**
- Always use `--force` to bypass prompts
- Always use `--yes` for non-interactive mode
- Wait for deployment to complete before moving on
- Check deployment URL in output

### 5. Verification

After deployment, verify:
- Build completed successfully (check Vercel output)
- No runtime errors in browser console
- Changes appear on production site

## Common Patterns

### File Modifications

**For existing files:**
- Use `read_file` to understand current structure
- Use `search_replace` for targeted changes
- Preserve existing code style and formatting

**For new files:**
- Use `write` to create new components/services
- Follow existing patterns from similar files
- Include proper TypeScript types

### Database Changes

**Migrations:**
- Create migration files in `supabase/migrations/`
- Use timestamp format: `YYYYMMDDHHMMSS_description.sql`
- Always use `IF NOT EXISTS` for safety
- Include RLS policies for new tables

**Example:**
```sql
-- supabase/migrations/20250125000001_feature_name.sql
BEGIN;
CREATE TABLE IF NOT EXISTS table_name (...);
ALTER TABLE existing_table ADD COLUMN IF NOT EXISTS ...;
COMMIT;
```

### Component Creation

1. Create component file
2. Create service file if needed
3. Add to parent component/page
4. Add route if it's a new page
5. Test locally
6. Deploy

## Error Handling

### Build Errors

If build fails:
1. Read error message carefully
2. Check for:
   - Missing imports
   - TypeScript errors
   - Syntax errors
   - Missing dependencies
3. Fix locally
4. Rebuild to verify
5. Then deploy

### Runtime Errors

If deployment succeeds but site has errors:
1. Check browser console
2. Check Vercel logs: `vercel logs <deployment-url>`
3. Fix and redeploy

## Production-First Approach

**Key Principle:** Fix → Deploy → Verify → Test

1. **Fix the code** - Make changes locally
2. **Deploy immediately** - Don't wait for approval
3. **Verify deployment** - Check build succeeded
4. **Test on production** - Use production URL

**Never:**
- Wait for user approval before deploying fixes
- Deploy without testing build locally first
- Skip verification step

## Tools Used

### Code Editing
- `read_file` - Read existing files
- `search_replace` - Make targeted edits
- `write` - Create new files
- `grep` - Search codebase
- `codebase_search` - Semantic search

### Verification
- `read_lints` - Check for linting errors
- `run_terminal_cmd` - Execute shell commands
- Local `npm run build` - Verify build works

### Deployment
- `git add/commit/push` - Version control
- `vercel --prod --force --yes` - Deploy to production

## Database Migrations

### When to Create Migrations

- New tables
- New columns
- Schema changes
- RLS policy updates
- Function changes

### Migration Best Practices

1. **Always use IF NOT EXISTS** for safety
2. **Include shims** for `supabase db reset` compatibility
3. **Test migrations** on local Supabase instance
4. **Order matters** - Use timestamps for ordering

### Example Migration Structure

```sql
BEGIN;

-- Add new column safely
ALTER TABLE table_name 
ADD COLUMN IF NOT EXISTS new_column TEXT;

-- Create index
CREATE INDEX IF NOT EXISTS idx_name 
ON table_name(new_column);

-- Update RLS
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
CREATE POLICY "policy_name" ON table_name
  FOR SELECT USING (auth.uid() = user_id);

COMMIT;
```

## Component Patterns

### React Components

```typescript
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface ComponentProps {
  // Props here
}

const Component: React.FC<ComponentProps> = ({ prop }) => {
  // State
  const [state, setState] = useState();
  
  // Effects
  useEffect(() => {
    // Load data
  }, []);
  
  // Handlers
  const handleAction = async () => {
    // Action logic
  };
  
  // Render
  return (
    <div>
      {/* Component JSX */}
    </div>
  );
};

export default Component;
```

### Service Classes

```typescript
export class ServiceName {
  static async methodName(params: Type): Promise<ReturnType> {
    try {
      const { data, error } = await supabase
        .from('table')
        .select('*')
        .eq('field', value);
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }
}
```

## Styling Guidelines

### Design System

- Use CSS variables from `design-system.css`
- Follow Windows 95 aesthetic
- No emojis in UI (per user preference)
- Consistent spacing using `var(--space-X)`
- Border styles: `2px solid var(--border)`

### Inline Styles

- Use inline styles for component-specific styling
- Reference design tokens when possible
- Keep styles consistent with existing patterns

## Testing Checklist

Before deploying:
- [ ] Code builds locally (`npm run build`)
- [ ] No linting errors (`read_lints`)
- [ ] TypeScript types are correct
- [ ] Imports are correct
- [ ] Database migrations are safe (IF NOT EXISTS)
- [ ] RLS policies are correct
- [ ] No console errors expected

After deploying:
- [ ] Build succeeded on Vercel
- [ ] Site loads on production URL
- [ ] Feature works as expected
- [ ] No console errors in browser

## Common Issues & Solutions

### Issue: Build fails with import error
**Solution:** Check import paths, ensure files exist, verify exports

### Issue: Dropdown not visible
**Solution:** Increase z-index (use 99999), use fixed positioning, calculate position with useEffect

### Issue: Mobile/desktop mismatch
**Solution:** Remove mobile-specific overrides, ensure same styles apply

### Issue: Database migration fails
**Solution:** Use IF NOT EXISTS, check for existing columns, verify RLS policies

### Issue: Component not rendering
**Solution:** Check route is added to App.tsx, verify component exports correctly

## Quick Reference Commands

```bash
# Full deployment workflow
cd /Users/skylar/nuke
git add -A
git commit -m "Description of changes"
git push origin main
vercel --prod --force --yes

# Local build check
cd nuke_frontend && npm run build

# Check linting
# (Use read_lints tool in Cursor)

# View deployment logs
vercel logs <deployment-url>
```

## Notes

- **Always deploy fixes immediately** - Don't wait for approval
- **Verify builds locally first** - Catch errors before deployment
- **Use production-first workflow** - Test on live site
- **Document breaking changes** - Update this doc if workflow changes
- **Follow user preferences** - No emojis, specific styling, etc.

## Success Indicators

A successful deployment:
1. ✅ Local build passes
2. ✅ Git commit successful
3. ✅ Vercel deployment completes
4. ✅ Production site loads
5. ✅ Feature works as expected
6. ✅ No console errors

---

**Remember:** The goal is fast, reliable deployments. Fix → Deploy → Verify → Test.

