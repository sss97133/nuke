# Foundational Location Classification System

## Overview

The Nuke API location system provides pattern-based work location classification that goes beyond simple GPS coordinates. It analyzes behavioral patterns, tool usage, equipment investment, and work consistency to meaningfully classify professional vs personal work contexts.

## Core Concepts

### Location Types
- **home** - Work performed at residential location
- **shop** - Work performed at dedicated workshop/garage
- **mobile** - Work performed at various client locations
- **outdoor** - Work performed in outdoor/field environments

### Work Contexts
- **personal** - DIY, hobby, or personal vehicle work
- **professional** - Commercial, business, or professional service work
- **commercial** - Large-scale business operations
- **educational** - Training or instructional contexts

### Professional Levels (Auto-Calculated)
- **professional** - Consistent high-quality work with premium tools
- **experienced** - Regular work with good tool quality and completion rates
- **hobbyist** - Recreational work with mixed tool quality
- **diy** - Occasional work with basic tools

## Database Schema

### Work Locations (`work_locations`)
```sql
CREATE TABLE work_locations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  location_type VARCHAR NOT NULL, -- home, shop, mobile, outdoor
  work_context VARCHAR NOT NULL,  -- personal, professional, commercial

  -- Scoring Systems (1-100)
  tool_quality_score INTEGER DEFAULT 0,
  organization_score INTEGER DEFAULT 0,
  confidence_score INTEGER DEFAULT 0,

  -- Equipment Detection
  has_lift BOOLEAN DEFAULT FALSE,
  has_compressor BOOLEAN DEFAULT FALSE,
  has_welding BOOLEAN DEFAULT FALSE,
  has_specialty_tools BOOLEAN DEFAULT FALSE,
  power_available VARCHAR, -- basic_110, 220_available, industrial_power

  -- Metadata
  detected_patterns JSONB,
  primary_use VARCHAR, -- restoration, fabrication, diagnostic, repair, maintenance
  surface_type VARCHAR, -- concrete, epoxy_coated, dirt, asphalt

  -- Timestamps
  inserted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Location Sessions (`location_sessions`)
```sql
CREATE TABLE location_sessions (
  id UUID PRIMARY KEY,
  work_location_id UUID REFERENCES work_locations(id),
  user_id UUID NOT NULL,

  -- Session Timing
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_minutes INTEGER,

  -- Work Details
  work_type VARCHAR, -- diagnostic, repair, maintenance, restoration
  completion_status VARCHAR, -- completed, partial, abandoned, ongoing
  quality_score INTEGER, -- 1-100 calculated post-session

  -- Documentation
  photo_count INTEGER DEFAULT 0,
  tag_count INTEGER DEFAULT 0,
  tools_used TEXT[], -- Array of tool names detected

  -- Analysis
  weather_conditions VARCHAR,
  notes TEXT,

  -- Timestamps
  inserted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Location Patterns (`location_patterns`)
```sql
CREATE TABLE location_patterns (
  id UUID PRIMARY KEY,
  work_location_id UUID REFERENCES work_locations(id),

  -- Pattern Classification
  pattern_type VARCHAR NOT NULL, -- tool_usage, work_schedule, quality_level, etc.
  pattern_name VARCHAR NOT NULL, -- frequent_snapon_usage, professional_schedule, etc.
  confidence FLOAT NOT NULL, -- 0.0 to 1.0

  -- Pattern Statistics
  frequency INTEGER,
  consistency FLOAT,
  trend VARCHAR, -- increasing, stable, decreasing, seasonal

  -- Timeline
  first_detected TIMESTAMPTZ,
  last_confirmed TIMESTAMPTZ,
  sample_size INTEGER,

  -- Pattern Data (JSONB)
  pattern_data JSONB,

  -- Timestamps
  inserted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

## API Endpoints

### Core Location Management

#### `GET /api/locations`
List all work locations for the authenticated user.

**Response:**
```json
{
  "status": "success",
  "data": [
    {
      "id": "uuid",
      "location_type": "shop",
      "work_context": "professional",
      "tool_quality_score": 85,
      "organization_score": 90,
      "confidence_score": 92,
      "has_lift": true,
      "has_compressor": true,
      "has_welding": true,
      "primary_use": "restoration",
      "detected_patterns": {
        "tools_detected": ["snap-on", "matco", "milwaukee"],
        "environment_analysis": {...},
        "analysis_timestamp": "2024-01-15T10:30:00Z"
      }
    }
  ]
}
```

#### `POST /api/locations`
Create a new work location.

**Request Body:**
```json
{
  "location": {
    "location_type": "shop",
    "work_context": "professional",
    "has_lift": true,
    "has_compressor": true,
    "has_welding": false,
    "power_available": "220_available",
    "primary_use": "restoration"
  }
}
```

#### `GET /api/locations/:id`
Get detailed location information including intelligence analysis.

**Response:**
```json
{
  "status": "success",
  "data": {
    "location": {...},
    "intelligence": {
      "professional_level": "professional",
      "professional_score": 88,
      "session_context": {...},
      "schedule_pattern": {...},
      "corporate_value": {
        "overall_score": 85,
        "data_richness": 78,
        "activity_level": 92
      }
    }
  }
}
```

### Context Analysis

#### `POST /api/locations/analyze-context`
Analyze work context from image tags and suggest location classification.

**Request Body:**
```json
{
  "image_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Response:**
```json
{
  "status": "success",
  "suggestion": "create_new_location",
  "data": {
    "location_type": "shop",
    "work_context": "professional",
    "tool_quality_score": 75,
    "organization_score": 80,
    "confidence_score": 65,
    "detected_patterns": {
      "tools_detected": ["milwaukee", "dewalt", "snap-on"],
      "environment_analysis": {
        "surface_quality": "epoxy_coated",
        "organization_score": 80,
        "clean_workspace": true
      }
    }
  }
}
```

### Session Management

#### `POST /api/locations/:location_id/sessions`
Start a new work session at a location.

**Request Body:**
```json
{
  "session": {
    "work_type": "diagnostic",
    "tools_used": ["obd_scanner", "multimeter"],
    "weather_conditions": "clear"
  }
}
```

#### `PUT /api/sessions/:session_id/end`
End a work session and provide completion details.

**Request Body:**
```json
{
  "session": {
    "completion_status": "completed",
    "photo_count": 15,
    "tag_count": 8,
    "notes": "Diagnosed electrical issue, replaced alternator"
  }
}
```

### Analytics & Reporting

#### `GET /api/locations/analytics`
Comprehensive location analytics dashboard.

**Response:**
```json
{
  "status": "success",
  "data": {
    "summary": {
      "total_locations": 3,
      "professional_locations": 2,
      "professional_ratio": 0.67,
      "avg_confidence": 78,
      "avg_tool_quality": 82
    },
    "distribution": {
      "by_type": {"shop": 2, "home": 1},
      "by_context": {"professional": 2, "personal": 1},
      "by_professional_level": {"professional": 2, "hobbyist": 1}
    },
    "professional_scores": {
      "equipment_analysis": {
        "penetration_rates": {
          "lift": 66.7,
          "compressor": 100.0,
          "welding": 33.3
        }
      },
      "pattern_richness": {
        "total_patterns": 12,
        "avg_patterns_per_location": 4.0
      }
    }
  }
}
```

#### `GET /api/locations/corporate-intelligence`
Corporate data harvesting intelligence summary.

**Response:**
```json
{
  "status": "success",
  "data": {
    "intelligence_summary": {
      "total_locations": 3,
      "high_value_locations": 2,
      "total_data_points": 45,
      "avg_professional_score": 82,
      "total_corporate_value": 245
    },
    "value_segments": {
      "premium": {"count": 1, "avg_score": 90},
      "standard": {"count": 1, "avg_score": 75},
      "developing": {"count": 1, "avg_score": 55}
    },
    "harvesting_opportunities": {
      "high_activity_locations": 2,
      "rich_data_sources": 1,
      "professional_targets": 2,
      "prime_harvest_candidates": 1
    },
    "competitive_intelligence": {
      "tool_brand_analysis": {
        "premium_brand_penetration": 65.0,
        "total_unique_tools": 23,
        "specialization_indicators": {
          "diagnostic": 5,
          "fabrication": 8,
          "restoration": 3
        }
      }
    }
  }
}
```

#### `GET /api/locations/export?format=csv`
Export location data for corporate analysis.

**CSV Response Headers:**
```
id,location_type,work_context,professional_level,tool_quality_score,confidence_score,equipment_value,session_count,pattern_count,corporate_value,data_richness
```

## Pattern Detection System

### Tool Usage Patterns
The system analyzes tool brands and usage frequency to determine professional level:

- **Premium Brands**: Snap-on, Matco, MAC, Cornwell (+20-30 quality points)
- **Professional Brands**: Milwaukee, DeWalt, Makita (+15-20 quality points)
- **Consumer Brands**: Craftsman, Kobalt (+5-10 quality points)
- **Budget Brands**: Harbor Freight, Hyper Tough (+0-5 quality points)

### Schedule Patterns
Detects work schedule consistency:

- **Professional Schedule**: Regular business hours, consistent weekday work
- **Hobbyist Schedule**: Weekend-heavy, irregular timing
- **Commercial Schedule**: Extended hours, 7-day operation
- **Project Schedule**: Intensive bursts followed by dormant periods

### Quality Indicators
Tracks completion rates and documentation quality:

- **High Completion Rate** (>85%): Strong professional indicator
- **Thorough Documentation** (>5 photos, >3 tags): Quality consciousness
- **Tool Specialization** (>70% usage rate): Professional expertise
- **Equipment Investment**: Lift, welding, specialty tools

### Environmental Analysis
Evaluates workspace organization and infrastructure:

- **Surface Quality**: Epoxy coating, concrete vs dirt/gravel
- **Organization Score**: Tool organization, cleanliness, lighting
- **Power Infrastructure**: 220V, industrial power availability
- **Climate Control**: Heating, cooling, humidity control

## Integration Examples

### React Frontend Integration

```javascript
// Location Analytics Dashboard Component
import React, { useEffect, useState } from 'react';

const LocationAnalytics = () => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/locations/analytics', {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json'
      }
    })
    .then(res => res.json())
    .then(data => {
      setAnalytics(data.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div>Loading analytics...</div>;

  return (
    <div className="location-analytics">
      <div className="summary-cards">
        <div className="card">
          <h3>Total Locations</h3>
          <p>{analytics.summary.total_locations}</p>
        </div>
        <div className="card">
          <h3>Professional Ratio</h3>
          <p>{(analytics.summary.professional_ratio * 100).toFixed(1)}%</p>
        </div>
        <div className="card">
          <h3>Avg Tool Quality</h3>
          <p>{analytics.summary.avg_tool_quality}</p>
        </div>
      </div>

      <div className="professional-distribution">
        <h3>Professional Level Distribution</h3>
        {Object.entries(analytics.distribution.by_professional_level).map(([level, count]) => (
          <div key={level} className="level-bar">
            <span>{level}: {count}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Context Analysis Integration

```javascript
// Auto-detect work context from uploaded images
const analyzeWorkContext = async (imageIds) => {
  const response = await fetch('/api/locations/analyze-context', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ image_ids: imageIds })
  });

  const result = await response.json();

  if (result.suggestion === 'create_new_location') {
    // Suggest creating new location with detected attributes
    const confirmed = confirm(
      `Detected ${result.data.work_context} ${result.data.location_type} context. Create new location?`
    );

    if (confirmed) {
      return createLocation(result.data);
    }
  } else if (result.suggestion === 'update_existing_location') {
    // Update existing location with new patterns
    return updateLocationPatterns(result.data.existing_location.id, result.data.suggested_updates);
  }
};
```

### Session Tracking Integration

```javascript
// Work session management
class WorkSessionManager {
  constructor(locationId) {
    this.locationId = locationId;
    this.currentSession = null;
  }

  async startSession(workType, tools = []) {
    const response = await fetch(`/api/locations/${this.locationId}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          work_type: workType,
          tools_used: tools,
          weather_conditions: await getWeatherConditions()
        }
      })
    });

    const result = await response.json();
    this.currentSession = result.data;
    return this.currentSession;
  }

  async endSession(completionStatus, photoCount, tagCount, notes) {
    if (!this.currentSession) return null;

    const response = await fetch(`/api/sessions/${this.currentSession.id}/end`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        session: {
          completion_status: completionStatus,
          photo_count: photoCount,
          tag_count: tagCount,
          notes: notes
        }
      })
    });

    const result = await response.json();
    this.currentSession = null;
    return result.data;
  }
}

// Usage
const sessionManager = new WorkSessionManager('location-uuid');
await sessionManager.startSession('diagnostic', ['obd_scanner', 'multimeter']);
// ... perform work ...
await sessionManager.endSession('completed', 12, 5, 'Fixed electrical issue');
```

## Corporate Data Harvesting

### Value Calculation Algorithm

The corporate value of a location is calculated using multiple factors:

```javascript
corporate_value = (
  (session_frequency * 2) +
  (pattern_richness * 10) +
  (documentation_quality * 1)
) * professional_multiplier / 3

professional_multiplier = {
  "professional": 1.0,
  "experienced": 0.8,
  "hobbyist": 0.6,
  "diy": 0.4
}
```

### High-Value Target Identification

Locations are flagged as high-value targets when they meet these criteria:

- **Corporate Value Score** ≥ 75
- **Professional Level** = "professional" or "experienced"
- **Data Richness** ≥ 60 (photos + tags + sessions)
- **Activity Level** ≥ 60 (session frequency)

### Market Segmentation

The system automatically segments users into market categories:

1. **Professional Market**
   - High tool quality scores (>75)
   - Business hour schedules
   - Premium equipment investment
   - High completion rates

2. **Enthusiast Market**
   - Mixed tool quality (50-75)
   - Weekend-heavy schedules
   - Moderate equipment investment
   - Good documentation habits

3. **DIY Market**
   - Basic tool quality (<50)
   - Irregular schedules
   - Minimal equipment investment
   - Limited documentation

## Performance Considerations

### Database Indexing

Key indexes for performance:

```sql
CREATE INDEX idx_work_locations_user_confidence ON work_locations(user_id, confidence_score DESC);
CREATE INDEX idx_location_sessions_location_start ON location_sessions(work_location_id, start_time DESC);
CREATE INDEX idx_location_patterns_location_type ON location_patterns(work_location_id, pattern_type);
CREATE INDEX idx_location_patterns_confidence ON location_patterns(confidence DESC, last_confirmed DESC);
```

### Caching Strategy

- Location intelligence reports cached for 1 hour
- Analytics dashboards cached for 15 minutes
- Pattern analysis results cached for 4 hours
- Corporate export data cached for 24 hours

### Rate Limiting

- Context analysis: 10 requests/minute per user
- Session management: 50 requests/minute per user
- Analytics endpoints: 20 requests/minute per user
- Export endpoints: 5 requests/hour per user

## Security Considerations

### Authentication Required

All location endpoints require authentication except:
- None (all endpoints are protected)

### Data Privacy

- Location data is user-scoped (users only see their own locations)
- Corporate intelligence aggregates data but removes PII
- Export endpoints include audit logging
- Geographic coordinates are not stored (pattern-based only)

### Rate Limiting & Abuse Prevention

- Context analysis limited to prevent computational abuse
- Export functionality requires elevated permissions
- Pattern detection results are cached to prevent repeated analysis costs

## Monitoring & Alerting

### Key Metrics

- **Pattern Detection Accuracy**: Confidence scores and manual verification rates
- **Corporate Value Distribution**: Value score distribution across user base
- **Professional Classification**: Accuracy of professional level detection
- **API Usage Patterns**: Endpoint usage and response times

### Alerting Thresholds

- Context analysis failure rate > 5%
- Average confidence score declining > 10% week-over-week
- Corporate value calculation errors > 1%
- Export request volumes > 1000/day (potential scraping)

## Future Enhancements

### Planned Features

1. **ML Model Integration** - Replace heuristic pattern detection with trained models
2. **Geographic Clustering** - Identify location clusters for market analysis
3. **Competitive Analysis** - Compare tool usage patterns across regions
4. **Predictive Analytics** - Forecast professional development trajectories
5. **Mobile App Integration** - Real-time session tracking and context detection

### API Versioning

Current API version: `v1`
Future versions will maintain backward compatibility for 12 months.

### Integration Roadmap

- **CRM Integration**: Export high-value leads to sales systems
- **Marketing Automation**: Target users based on professional level
- **Supply Chain Intelligence**: Track tool brand preferences by region
- **Competitive Intelligence**: Monitor professional equipment adoption rates
