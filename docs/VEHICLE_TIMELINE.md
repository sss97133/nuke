# Vehicle Timeline Technical Documentation

This document describes how the Vehicle Timeline component implements the Digital Vehicle Identity concept and Multi-Source Connector Framework that are core to Nuke's architecture.

## Architectural Alignment

### Digital Vehicle Identity Integration

The Vehicle Timeline is a direct implementation of the Digital Vehicle Identity concept:

1. **Persistent Identity Model**
   - Timeline tracks a vehicle throughout its entire lifecycle
   - Vehicle identity persists regardless of ownership changes
   - Each event contains confidence scoring for reliability assessment
   - History aggregation creates comprehensive vehicle provenance

2. **Trust-Building Mechanisms**
   - Timeline integrates events from both digital sources and physical verification
   - PTZ verified inspections appear as high-confidence timeline events
   - Professional work is captured as timeline events with attribution
   - Document verification becomes part of the immutable history

3. **Technical Implementation**
   - PostgreSQL table design with standardized fields for all event types
   - JSONB metadata fields for type-specific information
   - RLS policies for secure access control
   - Timeline view joins with vehicle information

### Multi-Source Connector Integration

The timeline component implements the Multi-Source Connector Framework:

1. **Standardized Connector Interface**
   - Each data source implements a consistent interface
   - Events from all sources follow a common structure
   - Confidence scoring standardized across all connectors
   - Automatic metadata parsing and transformation

2. **Event Aggregation**
   - Timeline service combines events from multiple sources
   - Duplicate detection with smart timestamp matching
   - Conflict resolution based on confidence scoring
   - Related events grouped for coherent presentation

3. **Source-Specific Implementation**
   - BaT connector translates auction events to timeline format
   - VIN database connector provides manufacturing events
   - User-submitted events maintain provenance information
   - PTZ verification events include rich media references

## Database Schema

The primary table structure for vehicle timeline events:

```sql
CREATE TABLE vehicle_timeline_events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  source VARCHAR(100) NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  confidence_score INT NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  metadata JSONB DEFAULT '{}'::jsonb,
  source_url TEXT,
  image_urls TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

### Key Fields

- **vehicle_id**: Links to the persistent vehicle identity
- **event_type**: Categorizes the event (e.g., 'maintenance', 'ownership_change', 'verification')
- **source**: Identifies the data connector source (e.g., 'bat', 'vin_database', 'ptz_verification')
- **confidence_score**: 0-100 score indicating reliability of the information
- **metadata**: JSONB field containing event type-specific details

## Component Implementation

The Vehicle Timeline is implemented through these key components:

1. **React Component (`VehicleTimeline/index.tsx`)**
   - Renders the timeline with appropriate styling and interactions
   - Handles filtering, sorting, and grouping of events
   - Implements responsive design for all device types
   - Utilizes card-based UI for individual events

2. **Timeline Actions Hook (`useTimelineActions.ts`)**
   - Provides standardized methods for timeline interactions
   - Implements create, update, delete operations
   - Handles filtering and search functionality
   - Integrates with the Button Actions Framework

3. **Connector Integration**
   - Each connector adds events through standardized methods
   - Event structure normalized across all sources
   - Metadata preserved in source-specific format
   - Timeline component renders source-specific UI elements

## User Interactions

The Vehicle Timeline supports these user interactions:

1. **Timeline Navigation**
   - Chronological scrolling through vehicle history
   - Filtering by event type, source, or time period
   - Expanding events to see detailed information
   - Collapsing related events to simplify view

2. **Event Management**
   - Adding new events with appropriate metadata
   - Editing events (with permission restrictions)
   - Flagging potentially incorrect information
   - Verifying events from professional sources

3. **Data Visualization**
   - Value tracking over time
   - Ownership history representation
   - Major lifecycle events highlighted
   - Confidence scoring visualization

## Testing

Testing for the Vehicle Timeline follows these approaches:

1. **Integration Testing**
   - Automatic database structure verification
   - Connector functionality validation
   - Component rendering tests
   - Timeline data manipulation tests

2. **Manual Testing**
   - Loading timeline for test vehicles
   - Visual verification of timeline rendering
   - Interaction testing for all user actions
   - Cross-device responsive testing

See `TIMELINE_TESTING.md` for detailed testing procedures.

## Integration Example

This example demonstrates how the Vehicle Timeline aggregates data from multiple sources:

```javascript
// Event from BaT auction connector
const batEvent = {
  vehicle_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "auction_sale",
  source: "bat",
  event_date: "2024-02-15T14:30:00Z",
  title: "Sold on Bring a Trailer",
  description: "Vehicle sold for $42,000 after 32 bids",
  confidence_score: 95, // High confidence from verified source
  metadata: {
    auction_id: "bat_12345",
    sale_price: 42000,
    bid_count: 32,
    auction_url: "https://bringatrailer.com/listing/2015-porsche-911-12345"
  },
  source_url: "https://bringatrailer.com/listing/2015-porsche-911-12345",
  image_urls: ["https://bringatrailer.com/wp-content/uploads/2024/02/image1.jpg"]
};

// Event from VIN database connector
const vinEvent = {
  vehicle_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "manufacture",
  source: "vin_database",
  event_date: "2015-06-12T00:00:00Z",
  title: "Vehicle Manufactured",
  description: "2015 Porsche 911 Carrera S manufactured in Stuttgart, Germany",
  confidence_score: 90,
  metadata: {
    vin: "WP0AB2A92FS135622",
    make: "Porsche",
    model: "911 Carrera S",
    year: 2015,
    plant_code: "S",
    plant_location: "Stuttgart, Germany"
  },
  source_url: null,
  image_urls: []
};

// Event from PTZ verification
const ptzEvent = {
  vehicle_id: "550e8400-e29b-41d4-a716-446655440000",
  event_type: "verification",
  source: "ptz_verification",
  event_date: "2024-03-01T10:15:00Z",
  title: "Professional Verification Completed",
  description: "Vehicle condition documented by certified technician",
  confidence_score: 98, // Highest confidence from physical verification
  metadata: {
    verification_id: "PTZ-2024-0342",
    technician_id: "TECH-112",
    condition_score: 9.2,
    verification_type: "full_inspection",
    notes: "Original paint, no accidents, all maintenance records verified"
  },
  source_url: "https://nuke.ptz/verification/PTZ-2024-0342",
  image_urls: [
    "https://nuke.storage.com/ptz/PTZ-2024-0342/exterior-front.jpg",
    "https://nuke.storage.com/ptz/PTZ-2024-0342/exterior-rear.jpg",
    "https://nuke.storage.com/ptz/PTZ-2024-0342/interior-dashboard.jpg"
  ]
};

// Timeline service aggregates these events with appropriate ordering and formatting
// Displays a unified timeline with consistent formatting but source-specific details
```

## Component Usage

To implement the Vehicle Timeline in a React component:

```jsx
import { VehicleTimeline } from 'components/VehicleTimeline';
import { useVehicleData } from 'hooks/useVehicleData';

const VehicleDetailPage = ({ vehicleId }) => {
  const { vehicle, loading, error } = useVehicleData(vehicleId);
  
  if (loading) return <Loader />;
  if (error) return <ErrorDisplay message={error.message} />;
  
  return (
    <div className="vehicle-detail-container">
      <VehicleHeader vehicle={vehicle} />
      
      <section className="vehicle-timeline-section">
        <h2>Vehicle History</h2>
        <VehicleTimeline 
          vehicleId={vehicleId}
          initialFilters={{ eventTypes: ['all'] }}
          showConfidenceScores={true}
          allowUserSubmission={true}
        />
      </section>
      
      {/* Other vehicle detail sections */}
    </div>
  );
};
```

## Future Enhancements

Planned enhancements to the Vehicle Timeline component:

1. **Timeline Analytics**
   - Value trend visualization
   - Ownership duration tracking
   - Comparative vehicle history analysis
   - Predictive value modeling integration

2. **Enhanced Verification**
   - Blockchain integration for immutable records
   - Document verification workflow
   - Third-party verification integration
   - Disputed information resolution workflow

3. **User Contribution**
   - Streamlined event submission process
   - Supporting documentation upload
   - Community validation mechanisms
   - Expertise recognition for verified submissions
