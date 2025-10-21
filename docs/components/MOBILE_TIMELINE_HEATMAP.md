# Mobile Timeline Heatmap Component

## Overview

Windows 95-style timeline visualization for mobile with GitHub-inspired year heatmap showing vehicle work activity. Features expandable years with clickable day cells displaying event images.

## Component

**File**: `/nuke_frontend/src/components/mobile/MobileTimelineHeatmap.tsx`

## Features

### 1. Year-Based Timeline
- **Expandable Headers**: Click to expand/collapse each year
- **Event Summary**: Shows total events and labor hours per year
- **Windows 95 Styling**: Blue headers with white outset borders

### 2. GitHub-Style Heatmap Calendar
- **Weekly Grid Layout**: 53 weeks × 7 days (Monday-Sunday)
- **Month Labels**: Positioned across the top
- **Day Labels**: M/T/W/T/F/S/S on the left
- **Color Coding**: Activity intensity visualization

### 3. Activity Color Scale
```typescript
No work:    #ebedf0  // Light gray
0 hours:    #d9f99d  // Light green (events but no hours)
< 2 hours:  #a7f3d0  // Light mint
2-5 hours:  #34d399  // Green
5-10 hours: #10b981  // Emerald
10+ hours:  #059669  // Dark green
```

### 4. Interactive Day Cells
- **Tooltips**: Hover shows date, event count, labor hours
- **Click to Open**: Displays modal with event details
- **Visual Feedback**: Border on days with events

### 5. Event Detail Modal
- **Windows 95 Modal**: Blue title bar with close button
- **Event Cards**: White inset borders
- **Event Images**: Grid layout with clickable thumbnails
- **Metadata**: Event type badges, labor hours badges

## Data Structure

### Timeline Event
```typescript
interface TimelineEvent {
  id: string;
  vehicle_id: string;
  title: string;
  description?: string;
  event_type: string;
  event_date: string;
  labor_hours?: number;
  image_urls?: string[];
  images?: { image_url: string; id: string }[];
  metadata?: any;
}
```

### Day Data
```typescript
interface DayData {
  date: string;
  events: TimelineEvent[];
  laborHours: number;
  imageCount: number;
}
```

### Year Data
```typescript
interface YearData {
  year: number;
  eventCount: number;
  laborHours: number;
  days: Map<string, DayData>;
}
```

## Database Query

```typescript
const { data: events, error } = await supabase
  .from('vehicle_timeline_events')
  .select(`
    id,
    vehicle_id,
    title,
    description,
    event_type,
    event_date,
    labor_hours,
    metadata,
    timeline_event_images!inner (
      image_url,
      id
    )
  `)
  .eq('vehicle_id', vehicleId)
  .order('event_date', { ascending: false });
```

## Usage

```tsx
import { MobileTimelineHeatmap } from './components/mobile/MobileTimelineHeatmap';

<MobileTimelineHeatmap vehicleId={vehicleId} />
```

## Implementation Details

### Calendar Generation

1. **Year Grid**: Generates all weeks of the year (52-53 weeks)
2. **Week Alignment**: Starts on Monday (adjusts for first day of year)
3. **Day Opacity**: Current year full opacity, previous years 30% opacity
4. **Grid Layout**: CSS Grid with 7 rows × 53 columns

### Performance Optimizations

- **Grouped Data**: Events grouped by year/day to minimize queries
- **Lazy Rendering**: Only expanded years render full calendar
- **Memoized Calculations**: Color calculations cached per day

### Mobile Optimizations

- **Touch-Friendly**: 12px × 12px cells with 2px gaps
- **Responsive Modal**: 90vw max width, 80vh max height
- **Scrollable Content**: Modal content scrolls independently
- **Fast Interactions**: No hover states, optimized for touch

## Windows 95 Design System

### Colors
- **Background**: `#c0c0c0` (silver gray)
- **Borders**: `#ffffff` (white) outset/inset
- **Active**: `#000080` (navy blue)
- **Text**: `#000000` (black)
- **Dividers**: `#808080` (gray)

### Typography
- **Font**: `"MS Sans Serif", sans-serif`
- **Headers**: 14px bold
- **Body**: 11-13px regular
- **Labels**: 8-10px

### Borders
- **Outset**: `2px outset #ffffff` (raised button)
- **Inset**: `2px inset #808080` (pressed/sunken)

## Event Image Integration

### Image Display
- **Grid Layout**: `repeat(auto-fill, minmax(60px, 1fr))`
- **Thumbnail Size**: 60px × 60px
- **Object Fit**: Cover
- **Border**: 1px solid gray

### Image Interaction
- **Click to Zoom**: Opens image in new tab
- **Full URL**: Uses original image_url from database
- **Fast Loading**: Thumbnails optimized for mobile

## Future Enhancements

### Planned Features
- [ ] Swipe between years (gesture navigation)
- [ ] Filter by event type
- [ ] Labor hours heat visualization toggle
- [ ] Event editing from modal
- [ ] Image lightbox instead of new tab
- [ ] Work session grouping on same day
- [ ] Export year as PDF

### Performance Improvements
- [ ] Virtual scrolling for years
- [ ] Image lazy loading
- [ ] Progressive calendar rendering
- [ ] Service worker caching

## Timeline Concept Integration

This component implements the core timeline concepts:

1. **Event-Centric**: Every day shows actual work performed
2. **Image-First**: Photos are the primary evidence
3. **Labor Tracking**: Hours visualized through color intensity
4. **Chronological Truth**: Uses EXIF dates when available
5. **Visual Documentation**: Clickable images provide proof

## Related Components

- **VehicleTimeline.tsx**: Desktop timeline with full details
- **MobileVehicleProfile.tsx**: Parent container
- **EventDetailModal**: Desktop event viewer
- **timeline_event_images**: Database table for event images

## Technical Notes

### Date Handling
- All dates use ISO format (`YYYY-MM-DD`)
- Timezone-aware calculations
- Handles leap years correctly

### Grid Positioning
- CSS Grid `grid-area` for week/day placement
- Week numbers start from 1
- Day of week: 1 (Monday) to 7 (Sunday)

### Memory Management
- Maps used for efficient lookups
- Sets used for expanded state
- No memory leaks on unmount

## Testing Checklist

- [x] Year expansion/collapse
- [x] Day cell click opens modal
- [x] Modal close button works
- [x] Image thumbnails clickable
- [x] Color coding accurate
- [x] Month labels aligned
- [x] Day labels correct
- [x] Touch scrolling smooth
- [x] No layout shifts
- [x] Works with 0 events

## Deployment

**Status**: ✅ DEPLOYED  
**Commit**: `c74466e3`  
**Date**: October 21, 2025  
**Environment**: Production (n-zero.dev)

