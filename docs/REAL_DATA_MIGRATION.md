
# Mock to Real Data Migration Guide

This document explains the approach taken to transition the application from using mock data to real data while maintaining stability and backward compatibility.

## Architecture Overview

Our application has been designed with a clear separation between mock data and real data. We've implemented a feature flag system that allows for:

1. Gradual migration of different parts of the application
2. Safe fallback to mock data when real data is unavailable
3. Control over which components use real data during development and testing

## Feature Flags

The feature flag utility (`src/utils/feature-flags.ts`) provides a central place to control which parts of the application use real data:

```typescript
// Master feature flag - when false, all mock data is used
export const USE_REAL_DATA_MASTER = true;

// Individual feature flags
export const featureFlags = {
  vehicles: true,
  marketplace: true,
  marketplaceDetail: true,
  fuel: true,
  icloudImages: true,
  auctions: true,
  userProfile: true,
  adminDashboard: false
};

// Helper function to check if a feature is enabled
export function isFeatureEnabled(flagName: keyof typeof featureFlags): boolean {
  if (!USE_REAL_DATA_MASTER) {
    return false;
  }
  
  return featureFlags[flagName] || false;
}
```

## Key Migration Patterns

### 1. Safe Data Fetching with Fallback

All data hooks follow this pattern:

```typescript
function useData() {
  // Initialize with loading state
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    async function fetchData() {
      try {
        setIsLoading(true);
        
        // Check if feature is enabled
        if (isFeatureEnabled('featureName')) {
          // Try to get real data from Supabase
          const { data, error } = await supabase.from('table').select('*');
          
          if (error) throw error;
          
          if (data && data.length > 0) {
            // Use real data
            setData(data);
            return;
          }
        }
        
        // Fall back to mock data
        setData(mockData);
      } catch (err) {
        console.error('Error:', err);
        // Fall back to mock data on error
        setData(mockData);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, []);
  
  // Return data and loading state
  return { data, isLoading };
}
```

### 2. Data Adapters

We use adapter functions to transform database data to match the expected format of components:

```typescript
function adaptVehicleFromDB(dbVehicle: any): Vehicle {
  return {
    id: dbVehicle.id,
    make: dbVehicle.make || '',
    model: dbVehicle.model || '',
    // Add defaults for every field
    // ...
  };
}
```

### 3. Error Boundary Components

Components are designed to handle:
- Loading states
- Empty data states
- Error states
- Partial or malformed data

## Database Tables

The main Supabase tables used in the application are:

- `vehicles`: User's vehicle collection
- `marketplace_listings`: Listings on the marketplace
- `fuel_entries`: Fuel tracking entries
- `icloud_albums` and `icloud_images`: Images from iCloud shared albums
- `auctions`: Marketplace auctions
- `profiles`: User profiles and preferences

## Migration Status

| Feature | Status | Notes |
|---------|--------|-------|
| Vehicles | ✅ Complete | Full CRUD operations |
| Marketplace | ✅ Complete | Listings and details |
| Fuel Tracking | ✅ Complete | Entries and statistics |
| iCloud Images | ✅ Complete | With caching |
| Auctions | ✅ Complete | Using Edge Function |
| User Profile | ⚠️ Partial | Basic info only |
| Admin Dashboard | ❌ Not Started | Still using mock data |

## Adding New Features

When adding a new feature that requires data:

1. Create a feature flag in `src/utils/feature-flags.ts`
2. Implement the feature with both real data fetching and mock data fallback
3. Add proper error handling and loading states
4. Document the database schema used for the feature

## Troubleshooting

If the application crashes when using real data:

1. **Check Authentication**: Make sure the user is authenticated
2. **Check Console Errors**: Look for specific error messages
3. **Verify Database Access**: Ensure the tables exist and have the expected schema
4. **Try Disabling Features**: Turn off specific features using the feature flags
5. **Verify Data Adapters**: Make sure they handle all edge cases and provide defaults

## Performance Considerations

- Use React Query for caching and automatic refetching
- Consider adding pagination for large datasets
- Implement optimistic updates for a better user experience
- Use appropriate Supabase indexes for frequently queried fields

## Future Improvements

- Complete migration of all features
- Add more robust error reporting
- Improve offline support with local storage
- Implement per-user feature flags for A/B testing
