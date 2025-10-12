# Location System API Usage Examples

## Quick Start Guide

### 1. Authentication Setup

All API calls require authentication. Include the JWT token in the Authorization header:

```bash
export API_TOKEN="your_jwt_token_here"
export API_BASE="http://localhost:4000/api"
```

### 2. Basic Location Management

#### Create Your First Location
```bash
curl -X POST "${API_BASE}/locations" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "location": {
      "location_type": "shop",
      "work_context": "professional",
      "has_lift": true,
      "has_compressor": true,
      "has_welding": false,
      "has_specialty_tools": true,
      "power_available": "220_available",
      "primary_use": "restoration"
    }
  }'
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "location_type": "shop",
    "work_context": "professional",
    "tool_quality_score": 0,
    "organization_score": 0,
    "confidence_score": 20,
    "has_lift": true,
    "has_compressor": true,
    "has_welding": false,
    "has_specialty_tools": true,
    "power_available": "220_available",
    "primary_use": "restoration",
    "detected_patterns": {},
    "inserted_at": "2024-01-15T10:30:00Z"
  }
}
```

#### List Your Locations
```bash
curl -X GET "${API_BASE}/locations" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

#### Get Location Details with Intelligence
```bash
LOCATION_ID="550e8400-e29b-41d4-a716-446655440000"
curl -X GET "${API_BASE}/locations/${LOCATION_ID}" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "location": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "location_type": "shop",
      "work_context": "professional",
      "confidence_score": 65,
      "tool_quality_score": 78,
      "sessions": [...],
      "patterns": [...]
    },
    "intelligence": {
      "professional_level": "experienced",
      "professional_score": 76,
      "session_context": {
        "context": "experienced",
        "avg_duration_hours": 3.5,
        "completion_rate": 0.85,
        "confidence": 78
      },
      "schedule_pattern": {
        "pattern": "weekend_professional",
        "weekday_ratio": 0.3,
        "business_hours_ratio": 0.4,
        "confidence": 72
      },
      "corporate_value": {
        "overall_score": 82,
        "data_richness": 75,
        "activity_level": 88,
        "professional_multiplier": 0.8
      }
    }
  }
}
```

### 3. Context Analysis from Images

#### Analyze Work Context
When users upload images, analyze them to suggest location classification:

```bash
curl -X POST "${API_BASE}/locations/analyze-context" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "image_ids": [
      "img-001-uuid",
      "img-002-uuid",
      "img-003-uuid"
    ]
  }'
```

**Expected Response (New Location Suggested):**
```json
{
  "status": "success",
  "suggestion": "create_new_location",
  "data": {
    "user_id": "user-uuid",
    "location_type": "shop",
    "work_context": "professional",
    "primary_use": "diagnostic",
    "tool_quality_score": 82,
    "organization_score": 75,
    "confidence_score": 68,
    "surface_type": "epoxy_coated",
    "detected_patterns": {
      "tools_detected": ["snap-on", "milwaukee", "matco", "obd_scanner"],
      "environment_analysis": {
        "surface_quality": "epoxy_coated",
        "organization_score": 75,
        "clean_workspace": true,
        "organized_tools": true,
        "proper_lighting": true,
        "professional_surfaces": true
      },
      "analysis_timestamp": "2024-01-15T14:22:33Z"
    }
  }
}
```

**Expected Response (Update Existing Location):**
```json
{
  "status": "success",
  "suggestion": "update_existing_location",
  "data": {
    "existing_location": {
      "id": "existing-location-uuid",
      "location_type": "shop",
      "work_context": "professional",
      "tool_quality_score": 75
    },
    "suggested_updates": {
      "tool_quality_score": 80,
      "organization_score": 82,
      "confidence_score": 85,
      "detected_patterns": {
        "latest_tools": ["snap-on", "milwaukee", "matco"],
        "latest_environment": {...},
        "last_updated": "2024-01-15T14:22:33Z"
      }
    }
  }
}
```

### 4. Work Session Management

#### Start a Work Session
```bash
LOCATION_ID="550e8400-e29b-41d4-a716-446655440000"
curl -X POST "${API_BASE}/locations/${LOCATION_ID}/sessions" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "session": {
      "work_type": "diagnostic",
      "tools_used": ["obd_scanner", "multimeter", "milwaukee_impact"],
      "weather_conditions": "clear"
    }
  }'
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "id": "session-uuid",
    "work_location_id": "550e8400-e29b-41d4-a716-446655440000",
    "user_id": "user-uuid",
    "start_time": "2024-01-15T09:30:00Z",
    "work_type": "diagnostic",
    "tools_used": ["obd_scanner", "multimeter", "milwaukee_impact"],
    "weather_conditions": "clear",
    "completion_status": null,
    "quality_score": null
  }
}
```

#### End a Work Session
```bash
SESSION_ID="session-uuid"
curl -X PUT "${API_BASE}/sessions/${SESSION_ID}/end" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "session": {
      "completion_status": "completed",
      "photo_count": 12,
      "tag_count": 8,
      "notes": "Diagnosed faulty oxygen sensor, replaced and cleared codes"
    }
  }'
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "id": "session-uuid",
    "work_location_id": "550e8400-e29b-41d4-a716-446655440000",
    "start_time": "2024-01-15T09:30:00Z",
    "end_time": "2024-01-15T11:45:00Z",
    "duration_minutes": 135,
    "completion_status": "completed",
    "photo_count": 12,
    "tag_count": 8,
    "quality_score": 87,
    "notes": "Diagnosed faulty oxygen sensor, replaced and cleared codes"
  }
}
```

### 5. Analytics and Intelligence

#### Get Location Analytics Dashboard
```bash
curl -X GET "${API_BASE}/locations/analytics" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "summary": {
      "total_locations": 3,
      "professional_locations": 2,
      "professional_ratio": 0.6666666666666666,
      "avg_confidence": 73,
      "avg_tool_quality": 78,
      "highest_confidence": 92
    },
    "distribution": {
      "by_type": {
        "shop": 2,
        "home": 1
      },
      "by_context": {
        "professional": 2,
        "personal": 1
      },
      "by_professional_level": {
        "professional": 1,
        "experienced": 1,
        "hobbyist": 1
      }
    },
    "professional_scores": {
      "levels": {
        "550e8400-e29b-41d4-a716-446655440000": "professional",
        "another-location-uuid": "experienced",
        "third-location-uuid": "hobbyist"
      },
      "equipment_analysis": {
        "counts": {
          "has_lift": 2,
          "has_compressor": 3,
          "has_welding": 1,
          "has_specialty_tools": 2
        },
        "penetration_rates": {
          "lift": 66.67,
          "compressor": 100.0,
          "welding": 33.33,
          "specialty_tools": 66.67
        }
      },
      "pattern_richness": {
        "total_patterns": 15,
        "avg_patterns_per_location": 5.0,
        "max_patterns": 8,
        "locations_with_patterns": 3
      }
    },
    "trends": {
      "confidence_trend": "improving",
      "activity_patterns": {
        "total_sessions": 47,
        "active_locations": 3,
        "highly_active": 2,
        "avg_sessions_per_location": 15.67
      }
    }
  }
}
```

#### Get Corporate Intelligence Report
```bash
curl -X GET "${API_BASE}/locations/corporate-intelligence" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "intelligence_summary": {
      "total_locations": 3,
      "high_value_locations": 2,
      "total_data_points": 62,
      "avg_professional_score": 81,
      "total_corporate_value": 248,
      "data_richness_score": 76
    },
    "professional_distribution": {
      "distribution": {
        "professional": 1,
        "experienced": 1,
        "hobbyist": 1
      },
      "professional_percentage": 33.33,
      "high_value_percentage": 66.67
    },
    "value_segments": {
      "premium": {
        "count": 1,
        "avg_score": 92,
        "avg_professional_score": 88
      },
      "standard": {
        "count": 1,
        "avg_score": 78,
        "avg_professional_score": 82
      },
      "developing": {
        "count": 1,
        "avg_score": 55,
        "avg_professional_score": 65
      }
    },
    "harvesting_opportunities": {
      "high_activity_locations": 2,
      "rich_data_sources": 2,
      "professional_targets": 2,
      "prime_harvest_candidates": 1
    },
    "competitive_intelligence": {
      "tool_brand_analysis": {
        "premium_brand_penetration": 72.5,
        "total_unique_tools": 28,
        "specialization_indicators": {
          "diagnostic": 6,
          "fabrication": 8,
          "restoration": 4,
          "precision": 3
        }
      },
      "professional_equipment_penetration": {
        "professional_lift": 66.67,
        "air_compressor": 100.0,
        "welding_equipment": 33.33,
        "specialty_tooling": 66.67
      },
      "market_segments": {
        "professional_market": {
          "count": 2,
          "avg_tool_quality": 81,
          "equipment_investment": {
            "avg_investment_level": 75,
            "high_investment_percentage": 100.0
          }
        },
        "enthusiast_market": {
          "count": 1,
          "avg_tool_quality": 58,
          "equipment_investment": {
            "avg_investment_level": 35,
            "high_investment_percentage": 0.0
          }
        }
      }
    }
  }
}
```

#### Export Corporate Data
```bash
# JSON Export
curl -X GET "${API_BASE}/locations/export" \
  -H "Authorization: Bearer ${API_TOKEN}"

# CSV Export
curl -X GET "${API_BASE}/locations/export?format=csv" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -o location_export.csv
```

**CSV Export Sample:**
```csv
id,location_type,work_context,professional_level,tool_quality_score,confidence_score,equipment_value,session_count,pattern_count,corporate_value,data_richness
550e8400-e29b-41d4-a716-446655440000,shop,professional,professional,88,92,85,23,8,92,82
another-location-uuid,shop,professional,experienced,78,85,70,18,5,78,75
third-location-uuid,home,personal,hobbyist,45,65,25,6,2,55,48
```

### 6. Session Analysis

#### Get Location Sessions with Analysis
```bash
LOCATION_ID="550e8400-e29b-41d4-a716-446655440000"
curl -X GET "${API_BASE}/locations/${LOCATION_ID}/sessions" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "sessions": [
      {
        "id": "session-1-uuid",
        "start_time": "2024-01-15T09:30:00Z",
        "end_time": "2024-01-15T11:45:00Z",
        "duration_minutes": 135,
        "work_type": "diagnostic",
        "completion_status": "completed",
        "quality_score": 87,
        "photo_count": 12,
        "tag_count": 8,
        "tools_used": ["obd_scanner", "multimeter", "milwaukee_impact"]
      }
    ],
    "analysis": {
      "work_context": {
        "context": "professional",
        "avg_duration_hours": 3.2,
        "completion_rate": 0.89,
        "tool_diversity": 15,
        "confidence": 85
      },
      "schedule_pattern": {
        "pattern": "professional_schedule",
        "weekday_ratio": 0.7,
        "business_hours_ratio": 0.8,
        "consistency_score": 78,
        "confidence": 82
      },
      "total_sessions": 23,
      "avg_session_time": 195
    }
  }
}
```

#### Get Location Patterns
```bash
LOCATION_ID="550e8400-e29b-41d4-a716-446655440000"
curl -X GET "${API_BASE}/locations/${LOCATION_ID}/patterns" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "patterns": [
      {
        "id": "pattern-1-uuid",
        "pattern_type": "tool_usage",
        "pattern_name": "frequent_snapon_usage",
        "confidence": 0.82,
        "frequency": 18,
        "consistency": 0.85,
        "trend": "stable",
        "sample_size": 23,
        "pattern_data": {
          "tool_name": "snap-on",
          "usage_rate": 0.78,
          "specialization_indicator": true
        }
      },
      {
        "id": "pattern-2-uuid",
        "pattern_type": "work_schedule",
        "pattern_name": "professional_schedule",
        "confidence": 0.78,
        "frequency": 23,
        "pattern_data": {
          "weekday_ratio": 0.7,
          "business_hours_ratio": 0.8
        }
      },
      {
        "id": "pattern-3-uuid",
        "pattern_type": "quality_level",
        "pattern_name": "high_completion_rate",
        "confidence": 0.89,
        "frequency": 21,
        "pattern_data": {
          "completion_rate": 0.89,
          "professional_indicator": true
        }
      }
    ],
    "grouped_patterns": {
      "tool_usage": [...],
      "work_schedule": [...],
      "quality_level": [...]
    },
    "pattern_summary": {
      "total_patterns": 8,
      "pattern_types": ["tool_usage", "work_schedule", "quality_level", "equipment_usage"],
      "avg_confidence": 81
    }
  }
}
```

#### Force Re-analyze Location Patterns
```bash
LOCATION_ID="550e8400-e29b-41d4-a716-446655440000"
curl -X POST "${API_BASE}/locations/${LOCATION_ID}/reanalyze" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "location": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "confidence_score": 88,
      "tool_quality_score": 82,
      "updated_at": "2024-01-15T16:30:00Z"
    },
    "new_patterns_detected": 3,
    "patterns": [
      {
        "pattern_type": "tool_usage",
        "pattern_name": "frequent_milwaukee_usage",
        "confidence": 0.75
      },
      {
        "pattern_type": "quality_level",
        "pattern_name": "thorough_documentation",
        "confidence": 0.88
      },
      {
        "pattern_type": "session_duration",
        "pattern_name": "consistent_work_sessions",
        "confidence": 0.72
      }
    ]
  }
}
```

## JavaScript SDK Example

Create a simple SDK for easier integration:

```javascript
class LocationAPI {
  constructor(baseURL, token) {
    this.baseURL = baseURL;
    this.token = token;
  }

  async request(method, endpoint, data = null) {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, options);
    return response.json();
  }

  // Location Management
  async createLocation(locationData) {
    return this.request('POST', '/locations', { location: locationData });
  }

  async getLocations() {
    return this.request('GET', '/locations');
  }

  async getLocation(id) {
    return this.request('GET', `/locations/${id}`);
  }

  async updateLocation(id, locationData) {
    return this.request('PUT', `/locations/${id}`, { location: locationData });
  }

  async deleteLocation(id) {
    return this.request('DELETE', `/locations/${id}`);
  }

  // Context Analysis
  async analyzeContext(imageIds) {
    return this.request('POST', '/locations/analyze-context', { image_ids: imageIds });
  }

  // Session Management
  async startSession(locationId, sessionData) {
    return this.request('POST', `/locations/${locationId}/sessions`, { session: sessionData });
  }

  async endSession(sessionId, sessionData) {
    return this.request('PUT', `/sessions/${sessionId}/end`, { session: sessionData });
  }

  async getLocationSessions(locationId) {
    return this.request('GET', `/locations/${locationId}/sessions`);
  }

  // Analytics
  async getAnalytics() {
    return this.request('GET', '/locations/analytics');
  }

  async getCorporateIntelligence() {
    return this.request('GET', '/locations/corporate-intelligence');
  }

  async exportData(format = 'json') {
    return this.request('GET', `/locations/export?format=${format}`);
  }

  // Patterns
  async getLocationPatterns(locationId) {
    return this.request('GET', `/locations/${locationId}/patterns`);
  }

  async reanalyzeLocation(locationId) {
    return this.request('POST', `/locations/${locationId}/reanalyze`);
  }
}

// Usage Example
const locationAPI = new LocationAPI('http://localhost:4000/api', 'your_jwt_token');

// Create a new professional shop location
const newLocation = await locationAPI.createLocation({
  location_type: 'shop',
  work_context: 'professional',
  has_lift: true,
  has_compressor: true,
  has_welding: true,
  power_available: '220_available'
});

console.log('Created location:', newLocation.data);

// Start a work session
const session = await locationAPI.startSession(newLocation.data.id, {
  work_type: 'diagnostic',
  tools_used: ['obd_scanner', 'multimeter'],
  weather_conditions: 'clear'
});

console.log('Started session:', session.data);

// End the session
const completedSession = await locationAPI.endSession(session.data.id, {
  completion_status: 'completed',
  photo_count: 8,
  tag_count: 5,
  notes: 'Successfully diagnosed and repaired electrical issue'
});

console.log('Completed session:', completedSession.data);

// Get analytics
const analytics = await locationAPI.getAnalytics();
console.log('Location Analytics:', analytics.data);
```

## Python SDK Example

```python
import requests
from typing import Dict, List, Optional

class LocationAPI:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.token = token
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict:
        url = f"{self.base_url}{endpoint}"
        response = requests.request(method, url, headers=self.headers, json=data)
        response.raise_for_status()
        return response.json()

    # Location Management
    def create_location(self, location_data: Dict) -> Dict:
        return self._request('POST', '/locations', {'location': location_data})

    def get_locations(self) -> Dict:
        return self._request('GET', '/locations')

    def get_location(self, location_id: str) -> Dict:
        return self._request('GET', f'/locations/{location_id}')

    def analyze_context(self, image_ids: List[str]) -> Dict:
        return self._request('POST', '/locations/analyze-context', {'image_ids': image_ids})

    def start_session(self, location_id: str, session_data: Dict) -> Dict:
        return self._request('POST', f'/locations/{location_id}/sessions', {'session': session_data})

    def end_session(self, session_id: str, session_data: Dict) -> Dict:
        return self._request('PUT', f'/sessions/{session_id}/end', {'session': session_data})

    def get_analytics(self) -> Dict:
        return self._request('GET', '/locations/analytics')

    def get_corporate_intelligence(self) -> Dict:
        return self._request('GET', '/locations/corporate-intelligence')

    def export_data(self, format: str = 'json') -> Dict:
        return self._request('GET', f'/locations/export?format={format}')

# Usage Example
api = LocationAPI('http://localhost:4000/api', 'your_jwt_token')

# Create a location
location = api.create_location({
    'location_type': 'shop',
    'work_context': 'professional',
    'has_lift': True,
    'has_compressor': True,
    'has_welding': False,
    'power_available': '220_available'
})

print(f"Created location: {location['data']['id']}")

# Analyze context from images
context_analysis = api.analyze_context([
    'image-uuid-1',
    'image-uuid-2',
    'image-uuid-3'
])

print(f"Context analysis: {context_analysis['suggestion']}")

# Get analytics
analytics = api.get_analytics()
print(f"Total locations: {analytics['data']['summary']['total_locations']}")
print(f"Professional ratio: {analytics['data']['summary']['professional_ratio']:.2%}")
```

## Error Handling Examples

### Common Error Responses

#### Authentication Error (401)
```json
{
  "error": "Unauthorized",
  "message": "Invalid or expired token"
}
```

#### Validation Error (422)
```json
{
  "status": "error",
  "errors": {
    "location_type": ["can't be blank"],
    "work_context": ["is invalid"]
  }
}
```

#### Not Found Error (404)
```json
{
  "error": "Work location not found"
}
```

#### Rate Limit Error (429)
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 60 seconds.",
  "retry_after": 60
}
```

### JavaScript Error Handling
```javascript
async function createLocationWithErrorHandling(locationData) {
  try {
    const result = await locationAPI.createLocation(locationData);
    return { success: true, data: result.data };
  } catch (error) {
    if (error.response) {
      switch (error.response.status) {
        case 401:
          return { success: false, error: 'Authentication required' };
        case 422:
          return { success: false, error: 'Invalid location data', details: error.response.data.errors };
        case 429:
          return { success: false, error: 'Rate limit exceeded', retryAfter: error.response.data.retry_after };
        default:
          return { success: false, error: 'Unknown error occurred' };
      }
    }
    return { success: false, error: 'Network error' };
  }
}
```

## Testing Examples

### Unit Test Examples (JavaScript/Jest)

```javascript
describe('Location API', () => {
  let locationAPI;

  beforeEach(() => {
    locationAPI = new LocationAPI('http://localhost:4000/api', 'test_token');
  });

  test('should create a professional shop location', async () => {
    const locationData = {
      location_type: 'shop',
      work_context: 'professional',
      has_lift: true,
      has_compressor: true
    };

    const result = await locationAPI.createLocation(locationData);

    expect(result.status).toBe('success');
    expect(result.data.location_type).toBe('shop');
    expect(result.data.work_context).toBe('professional');
    expect(result.data.confidence_score).toBeGreaterThan(0);
  });

  test('should analyze context and suggest new location', async () => {
    const imageIds = ['img1', 'img2', 'img3'];
    const result = await locationAPI.analyzeContext(imageIds);

    expect(result.status).toBe('success');
    expect(['create_new_location', 'update_existing_location']).toContain(result.suggestion);
    expect(result.data).toHaveProperty('confidence_score');
  });

  test('should track work session lifecycle', async () => {
    // Start session
    const sessionStart = await locationAPI.startSession('location-id', {
      work_type: 'diagnostic',
      tools_used: ['obd_scanner']
    });

    expect(sessionStart.data).toHaveProperty('start_time');
    expect(sessionStart.data.work_type).toBe('diagnostic');

    // End session
    const sessionEnd = await locationAPI.endSession(sessionStart.data.id, {
      completion_status: 'completed',
      photo_count: 5,
      notes: 'Fixed issue'
    });

    expect(sessionEnd.data).toHaveProperty('end_time');
    expect(sessionEnd.data.completion_status).toBe('completed');
    expect(sessionEnd.data.quality_score).toBeGreaterThan(0);
  });
});
```

## Performance Testing

### Load Testing Script (Artillery)

```yaml
# artillery-load-test.yml
config:
  target: 'http://localhost:4000'
  phases:
    - duration: 60
      arrivalRate: 10
  defaults:
    headers:
      Authorization: 'Bearer your_test_token'
      Content-Type: 'application/json'

scenarios:
  - name: "Location Analytics Load Test"
    weight: 40
    flow:
      - get:
          url: "/api/locations/analytics"
      - get:
          url: "/api/locations"

  - name: "Context Analysis Load Test"
    weight: 30
    flow:
      - post:
          url: "/api/locations/analyze-context"
          json:
            image_ids: ["img1", "img2", "img3"]

  - name: "Session Management Load Test"
    weight: 30
    flow:
      - post:
          url: "/api/locations/{{ $randomString() }}/sessions"
          json:
            session:
              work_type: "diagnostic"
              tools_used: ["scanner"]
```

Run with: `artillery run artillery-load-test.yml`

This comprehensive guide provides everything needed to integrate with the location classification system, from basic CRUD operations to advanced analytics and corporate intelligence features.