# VehicleImageViewer Component

## Overview

The VehicleImageViewer component provides a comprehensive interface for viewing, managing, and uploading vehicle images with support for multi-resolution optimization and professional workflows.

## Architecture

### Component Structure

```
VehicleImageViewer/
├── VehicleImageViewer.tsx      # Main component (264 lines)
├── image-viewer/
│   ├── useImageViewerState.ts  # State management hook (185 lines)
│   ├── ImageGrid.tsx           # Grid display component (168 lines)
│   ├── ImageFilters.tsx        # Filter interface (124 lines)
│   └── ImageUploader.tsx       # Upload interface (124 lines)
```

### Modular Design Benefits

- **Separation of Concerns**: Each module handles a specific responsibility
- **Testability**: Components can be tested independently
- **Reusability**: Modules can be composed in different configurations
- **Maintainability**: Smaller, focused components reduce complexity

## API Reference

### Props

```typescript
interface VehicleImageViewerProps {
  vehicleId: string;              // Required vehicle identifier
  title?: string;                 // Display title (default: "Vehicle Images")
  showAddButton?: boolean;        // Enable upload functionality
  canDelete?: boolean;            // Enable deletion capabilities
  onAddPhotos?: () => void;       // Callback after photo addition
  onImportComplete?: () => void;  // Callback after bulk import
  className?: string;             // Additional CSS classes
  style?: React.CSSProperties;    // Inline styles
  extraRightControls?: ReactNode; // Additional header controls
}
```

### State Management

The component uses the `useImageViewerState` hook for centralized state management:

```typescript
const {
  loadedImages,        // Array of image records
  workingIds,          // Images currently processing
  lightboxOpen,        // Lightbox display state
  selectedImage,       // Currently selected image
  editMode,           // Batch selection mode
  filters,            // Active filter state
  sortMode,           // Current sorting method
  // ... methods
} = useImageViewerState(vehicleId);
```

## Features

### Image Display
- Grid layout with responsive columns
- Hover controls for quick actions
- Primary image indication
- Sensitive content badges

### Filtering and Sorting
- Process stage filtering
- Workflow role filtering
- Area and part filtering
- Multiple sort modes (primary first, newest, oldest)

### Image Management
- Batch selection and operations
- Set primary image functionality
- Mark images as sensitive/public
- Tag editing interface

### Upload Functionality
- Drag-and-drop file upload
- Multiple file selection
- Progress indication
- Automatic variant generation

### Lightbox Integration
- Full-screen image viewing
- Keyboard navigation
- Image metadata display

## Performance Optimizations

### Image Loading
- Lazy loading for off-screen images
- Optimal variant selection based on display context
- Progressive enhancement with fallbacks

### Component Performance
- Memoized callbacks to prevent unnecessary re-renders
- Efficient state updates with batching
- Optimized re-render patterns

## Usage Examples

### Basic Usage

```typescript
<VehicleImageViewer
  vehicleId="123e4567-e89b-12d3-a456-426614174000"
  title="Vehicle Photos"
/>
```

### With Upload Functionality

```typescript
<VehicleImageViewer
  vehicleId="123e4567-e89b-12d3-a456-426614174000"
  showAddButton={true}
  onAddPhotos={() => console.log('Photos added')}
/>
```

### With Custom Controls

```typescript
<VehicleImageViewer
  vehicleId="123e4567-e89b-12d3-a456-426614174000"
  extraRightControls={
    <button onClick={handleExport}>Export All</button>
  }
/>
```

## Error Handling

### Upload Failures
- Automatic cleanup of partial uploads
- User feedback for failed operations
- Retry mechanisms for network issues

### Loading Errors
- Graceful degradation for missing images
- Placeholder content for empty states
- Error boundaries for component isolation

## Testing Strategy

### Unit Tests
- Component rendering with various props
- State management hook behavior
- User interaction handling

### Integration Tests
- Upload workflow end-to-end
- Filter and sort functionality
- Lightbox navigation

### Performance Tests
- Image loading performance
- Component render performance
- Memory usage optimization

## Migration Notes

### From Monolithic Component
The original 1,058-line component was refactored into modular architecture:
- 75% reduction in main component size (1,058 → 264 lines)
- Improved maintainability and testability
- Better separation of concerns
- Enhanced reusability across the application