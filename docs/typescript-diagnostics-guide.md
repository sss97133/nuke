# TypeScript Diagnostics Guide for Vehicle-Centric Development

This guide outlines the TypeScript diagnostic tools created to maintain code quality in our vehicle-centric platform, with special emphasis on maintaining data integrity across multiple sources.

## 1. Diagnostic Tools Overview

We've created three complementary tools to help diagnose and fix TypeScript issues, with special focus on vehicle data handling:

1. **Local Diagnostic Script** - For rapid development feedback
2. **GitHub Actions Workflow** - For CI/CD pipeline integration
3. **Vehicle Data Integrity Hook** - For pre-commit validation

These tools align with our vehicle-centric architecture that treats vehicles as first-class digital entities with persistent identities, ensuring that type safety extends to our multi-source connector framework and timeline-based event aggregation.

## 2. Using the Local Diagnostic Script

The TypeScript diagnostic script provides immediate feedback during development:

```bash
# Run basic diagnostics
node scripts/typescript-diagnostics.js

# Focus only on vehicle-related components
node scripts/typescript-diagnostics.js --vehicle-only

# Generate a comprehensive HTML report
node scripts/typescript-diagnostics.js --full-report

# Attempt to automatically fix common issues
node scripts/typescript-diagnostics.js --fix
```

### What It Checks

- **Null/Undefined Errors**: Identifies missing null checks in vehicle data handling
- **Type Definition Errors**: Finds missing interfaces for timeline events and vehicle data
- **Type Mismatch Errors**: Catches issues with confidence scoring and data transformation
- **Property Access Errors**: Identifies unsafe property access on vehicle metadata
- **'any' Type Usage**: Finds places where type safety is compromised
- **Vehicle Data Issues**: Special focus on real vehicle data handling

## 3. GitHub Actions Workflow 

The `typescript-diagnostics.yml` workflow runs on PRs and provides detailed reports categorized by error type.

Key features:
- Error categorization to identify patterns
- Detailed reports on vehicle data handling
- Recommendations based on error patterns
- Lists files with most errors to prioritize fixes
- PR comments with actionable insights

## 4. Vehicle Data Integrity Check

The `.husky/vehicle-data-check` hook runs automatically before commits to ensure vehicle data integrity:

```bash
# Run manually (if needed)
./.husky/vehicle-data-check
```

This hook provides specialized checks:
- Validates proper typing for vehicle data and timeline events
- Enforces our preference for real vehicle data over mock data
- Checks for proper error handling in vehicle operations
- Validates alignment with our vehicle-centric architecture

## 5. Best Practices for TypeScript in Vehicle-Centric Development

Based on our architecture and lessons learned:

1. **Define Clear Interfaces** - Create explicit interfaces for:
   - `RawTimelineEvent` - For database records
   - `VehicleData` - For processed vehicle information
   - Event-specific metadata interfaces

2. **Implement Type Guards** - Create functions like `isExistingEvent()` to validate data types

3. **Real Data Preference** - Always prefer real vehicle data over mock data:
   ```typescript
   // Preferred approach - use real data
   const vehicles = await getVehicleData(userId);
   
   // Avoid mock data
   // const mockVehicle = { /* ... */ };
   ```

4. **Null Safety** - Always use optional chaining with vehicle data:
   ```typescript
   // Safe approach
   const make = vehicleData?.make || '';
   
   // Unsafe - may cause runtime errors
   const make = vehicleData.make;
   ```

5. **Confidence Scoring** - Properly type confidence scores:
   ```typescript
   interface TimelineEvent {
     confidenceScore: number; // 0-100
     // ...
   }
   ```

## 6. Debugging Workflow

For most efficient TypeScript debugging:

1. **Run Comprehensive Analysis** - Start with `node scripts/typescript-diagnostics.js` to get a complete overview
2. **Categorize Issues** - Group errors by type (null checks, interfaces, etc.)
3. **Fix Root Causes** - Address interface definitions first, then null checks
4. **Use Type Guards** - Implement reusable type guards for complex validation
5. **Staged Commits** - Fix issues in logical groups, not one at a time

By following this systematic approach, we ensure our vehicle-centric platform maintains type safety throughout the multi-source connector framework, timeline service, and vehicle data operations.

## 7. Example: VehicleTimeline Component

The `VehicleTimeline` component demonstrates our best practices:

```typescript
// Clear interface definitions
interface RawTimelineEvent {
  id: string;
  vehicleId: string;
  eventType: string;
  eventSource: string;
  eventDate: string;
  title: string;
  description: string;
  confidenceScore: number;
  metadata: Record<string, any>;
  sourceUrl?: string;
  imageUrls?: string[];
}

// Type guard implementation
function isExistingEvent(event: Partial<RawTimelineEvent>): event is RawTimelineEvent {
  return !!event.id;
}

// Proper null handling with real data
const eventDate = currentEvent?.eventDate || new Date().toISOString();
```

## 8. Integrating with CI/CD

Our GitHub Actions workflow will run on every PR, providing detailed feedback. The report includes:

- Error categorizations
- Vehicle data specific reports
- Files with most errors
- Actionable recommendations

## 9. Contact

For questions about these diagnostic tools, contact the Nuke engineering team.
