# Mobile Camera Capture Implementation Guide

## Quick Start

### 1. Add the Rapid Camera Capture Component

Add the RapidCameraCapture component to your main app layout:

```tsx
import RapidCameraCapture from './components/mobile/RapidCameraCapture';

function App() {
  return (
    <>
      {/* Your existing app content */}
      <RapidCameraCapture />
    </>
  );
}
```

### 2. Import Mobile Styles

Add the mobile capture styles to your app:

```tsx
import './styles/mobile-capture.css';
```

### 3. Use the Mobile Capture Hook

For custom implementations, use the provided hook:

```tsx
import { useMobileCameraCapture } from './hooks/useMobileCameraCapture';

function CustomCaptureComponent() {
  const { state, captureImages } = useMobileCameraCapture({
    enableOfflineQueue: true,
    batchMode: true,
    maxBatchSize: 5
  });

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      captureImages(e.target.files);
    }
  };

  return (
    <div>
      <input 
        type="file" 
        accept="image/*" 
        capture="environment"
        multiple
        onChange={handleFileInput}
      />
      {state.isCapturing && <p>Processing...</p>}
      {state.queuedCount > 0 && <p>{state.queuedCount} images queued</p>}
    </div>
  );
}
```

## Key Features

### 1. Instant Camera Access
- Floating camera button always visible
- Single tap to open camera
- Multiple photo capture support
- Works offline with queuing

### 2. Intelligent Auto-Filing
Based on AI guardrails, images are automatically filed by:
- **VIN Detection**: Scans for VINs in images
- **Recent Context**: Uses last viewed vehicle
- **GPS Location**: Matches work locations
- **Visual Analysis**: Identifies vehicles in frame

### 3. User-Specific Processing
The system adapts to each user's:
- **Profession**: Mechanic, dealer, enthusiast
- **Expertise**: Part identification level
- **Privacy**: License plate blurring, VIN encryption
- **Workflow**: Filing preferences, categorization

### 4. Offline Capability
- Images queued when offline
- Local processing for basic extraction
- Automatic sync when online
- Progress preserved across sessions

## Configuration

### User Guardrails Setup

Configure user-specific AI processing:

```typescript
// In user preferences/settings
const userGuardrails = {
  personal: {
    profession: 'mechanic',
    expertise_areas: ['engine', 'electrical'],
    privacy_settings: {
      blur_license_plates: true,
      encrypt_vins: false
    }
  },
  domain: {
    part_identification: {
      level: 'expert',
      include_part_numbers: true
    },
    problem_diagnosis: true,
    suggest_next_steps: true
  },
  organizational: {
    filing_triggers: {
      detect_vin_in_image: true,
      match_recent_context: true,
      use_gps_location: false
    }
  }
};
```

### Mobile-Specific Settings

```typescript
const mobileSettings = {
  camera: {
    quality: 0.8, // Balance quality vs size
    maxWidth: 1920, // Resize for performance
    autoRotate: true // Fix orientation
  },
  capture: {
    soundEnabled: true,
    vibrationFeedback: true,
    showPreview: true
  },
  processing: {
    offlineOCR: true, // Enable local text extraction
    edgeAI: false, // Use on-device ML (if available)
    compressionLevel: 'medium'
  }
};
```

## Usage Scenarios

### 1. Mechanic Workflow
```
1. Open vehicle profile on tablet
2. Start work on vehicle
3. Use phone to capture progress photos
4. Photos automatically file to active vehicle
5. AI extracts part numbers, identifies issues
6. Timeline updates with work progress
```

### 2. Dealer Inventory
```
1. Walk lot with phone
2. Rapid capture mode for multiple vehicles
3. VIN detection sorts photos automatically
4. Batch processing creates inventory records
5. AI suggests missing angles
```

### 3. Enthusiast Documentation
```
1. Working on personal project
2. Capture disassembly sequence
3. Photos batch by work session
4. AI tracks progress over time
5. Automatic before/after pairing
```

## Performance Tips

### 1. Optimize Image Size
- Resize images before upload
- Use appropriate quality settings
- Generate thumbnails locally

### 2. Batch Processing
- Group similar photos
- Process during idle time
- Use progressive enhancement

### 3. Cache Management
- Store recent vehicle data
- Preload common patterns
- Clear old offline data

## Troubleshooting

### Common Issues

1. **Camera Not Opening**
   - Check browser permissions
   - Ensure HTTPS connection
   - Try different browser

2. **Slow Processing**
   - Reduce image quality
   - Enable batch mode
   - Check network speed

3. **Wrong Vehicle Filing**
   - Update recent context
   - Check VIN visibility
   - Adjust guardrail settings

### Debug Mode

Enable debug logging:

```typescript
localStorage.setItem('mobileCaptureDebug', 'true');
```

View capture stats:
```typescript
const stats = JSON.parse(localStorage.getItem('captureStats') || '{}');
console.log('Capture statistics:', stats);
```

## Integration Examples

### With Vehicle Profile Page

```tsx
function VehicleProfile({ vehicleId }) {
  // Set context for camera capture
  useEffect(() => {
    localStorage.setItem(`lastVehicle_${user.id}`, vehicleId);
  }, [vehicleId]);

  return (
    <div>
      {/* Vehicle details */}
      <RapidCameraCapture />
    </div>
  );
}
```

### With Work Session Tracking

```tsx
function WorkSession({ sessionId }) {
  const { captureImages } = useMobileCameraCapture({
    batchMode: true,
    autoProcessing: true
  });

  // Link captures to work session
  const contextualCapture = useCallback(async (files) => {
    const results = await captureImages(files);
    // Associate with session
    await linkToWorkSession(sessionId, results);
  }, [sessionId, captureImages]);
}
```

## Future Enhancements

### Planned Features
1. Voice commands for hands-free capture
2. AR overlays for capture guidance
3. Real-time part identification
4. Collaborative capture sessions
5. Advanced privacy controls

### API Extensions
- Custom AI model integration
- Third-party filing systems
- Enterprise guardrail management
- Compliance reporting

## Support

For issues or questions:
1. Check the troubleshooting guide
2. Review guardrails documentation
3. Contact support with debug logs

Remember: The system learns from your usage patterns. The more you use it, the smarter it becomes at filing your images correctly!
