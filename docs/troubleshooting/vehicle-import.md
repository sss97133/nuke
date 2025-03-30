# Vehicle Import Troubleshooting Guide

## Overview
This guide covers the technical process of importing vehicles from signup to collection, including common issues and their solutions.

## Import Process Flow

### 1. User Signup
```typescript
// User signs up with email and password
const { data: { user } } = await supabase.auth.signUp({
  email,
  password,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback`
  }
});
```

### 2. Profile Creation
```typescript
// Create user profile
await supabase.from('profiles').insert([{
  id: user.id,
  email: user.email,
  // ... other profile fields
}]);
```

### 3. Vehicle Import Methods

#### CSV Import
```typescript
// Parse CSV file
const vehicles = await Papa.parse(csvFile, {
  header: true,
  skipEmptyLines: true
});

// Process and validate vehicles
const processedVehicles = vehicles.data.map(vehicle => ({
  ...vehicle,
  user_id: user.id,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
}));

// Insert into database
await supabase.from('vehicles').insert(processedVehicles);
```

#### Bulk Import
- Supports larger datasets
- Includes progress tracking
- Handles batch processing with error recovery
- Uses batch IDs for tracking

#### Manual Entry
- Rich data entry form
- Supports all vehicle fields
- Real-time validation

## Common Issues and Solutions

### 1. Authentication Issues
**Problem**: "User not authenticated" error
**Solution**: 
- Ensure user is logged in
- Check session validity
- Verify email verification status

### 2. CSV Import Failures
**Problem**: CSV parsing errors
**Solution**:
- Verify CSV format (UTF-8 encoding)
- Check required fields (make, model, year)
- Validate data types (year as number, dates in correct format)

### 3. Database Errors
**Problem**: Insert/update failures
**Solution**:
- Check data types match schema
- Verify required fields are present
- Ensure unique constraints aren't violated

### 4. Media Import Issues
**Problem**: Image upload failures
**Solution**:
- Verify file size limits
- Check supported file formats
- Validate image URLs

## Required Fields

### Basic Vehicle Information
- make (string)
- model (string)
- year (number)
- user_id (string)

### Optional Fields
- color
- mileage
- vin
- license_plate
- purchase_date
- purchase_price
- current_value
- condition
- location
- insurance_policy
- notes

## Data Validation Rules

1. **Year**
   - Must be a valid number
   - Should be between 1900 and current year + 1

2. **Mileage**
   - Must be a positive number
   - Optional field

3. **VIN**
   - Must be 17 characters if provided
   - Optional field

4. **Dates**
   - Must be valid ISO date strings
   - Optional fields

## Collection Management

### Creating Collections
```typescript
const collection = await createCollection('Collection Name', 'Description');
```

### Adding Vehicles to Collections
- During import: Specify collection_id
- After import: Update vehicle collection_id

## Error Handling

### Common Error Messages
1. "No valid vehicle data found in the CSV"
   - Check CSV format and required fields

2. "Failed to import vehicles"
   - Check database connection
   - Verify data types

3. "Authentication error"
   - Verify user session
   - Check email verification

## Best Practices

1. **Data Preparation**
   - Clean data before import
   - Validate required fields
   - Format dates correctly

2. **Import Process**
   - Use batch processing for large imports
   - Implement progress tracking
   - Handle errors gracefully

3. **Post-Import**
   - Verify imported data
   - Check collection assignments
   - Validate media attachments

## Debugging Tips

1. **Console Logging**
   ```typescript
   console.log('Import progress:', progress);
   console.error('Import error:', error);
   ```

2. **Database Queries**
   ```sql
   -- Check imported vehicles
   SELECT * FROM vehicles WHERE user_id = 'user_id';
   
   -- Verify collections
   SELECT * FROM vehicle_collections WHERE user_id = 'user_id';
   ```

3. **Error Tracking**
   - Monitor error logs
   - Check network requests
   - Verify database constraints

## Support

For additional support:
1. Check the application logs
2. Review the database schema
3. Contact technical support 