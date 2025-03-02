
# Studio Module Architecture

The Studio module provides a comprehensive set of tools for recording, streaming, editing, and configuring virtual production environments, with a focus on automotive content creation.

## Overview

The Studio module enables users to:
- Create and configure 3D virtual studios
- Control PTZ (Pan-Tilt-Zoom) cameras
- Record video content
- Stream live content
- Edit recorded media
- Analyze studio performance

## Module Structure

```
src/
├── components/studio/       # Core studio components
│   ├── analytics/           # Analytics components
│   ├── controls/            # Camera and recording controls
│   ├── form/                # Form components for configuration
│   ├── sections/            # Main UI sections
│   │   └── preview/         # 3D preview components
│   ├── tabs/                # Tab view components
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Utility functions
├── hooks/                   # Custom React hooks
└── pages/                   # Page components
```

## Key Components

### Pages
- [Studio](../src/pages/Studio.tsx) - Main studio page component

### Core Components
- [RecordTab](../src/components/studio/tabs/RecordTab.tsx) - Recording interface
- [StreamTab](../src/components/studio/tabs/StreamTab.tsx) - Streaming interface
- [EditTab](../src/components/studio/tabs/EditTab.tsx) - Editing interface
- [SettingsTab](../src/components/studio/tabs/SettingsTab.tsx) - Studio configuration

### Preview & Visualization
- [StudioPreview](../src/components/studio/sections/PreviewSection.tsx) - Preview container
- [StudioScene](../src/components/studio/sections/preview/StudioScene.tsx) - 3D scene renderer
- [LightingControls](../src/components/studio/sections/preview/LightingControls.tsx) - Lighting mode controls

### Controls
- [RecordingControls](../src/components/studio/controls/RecordingControls.tsx) - Recording interface
- [StreamingControls](../src/components/studio/controls/StreamingControls.tsx) - Streaming interface
- [AudioControls](../src/components/studio/controls/AudioControls.tsx) - Audio management
- [CameraControls](../src/components/studio/controls/CameraControls.tsx) - Camera settings
- [PTZControls](../src/components/studio/controls/PTZControls.tsx) - Pan-Tilt-Zoom camera controls
- [ControlButtons](../src/components/studio/sections/ControlButtons.tsx) - Main control buttons

### Configuration Forms
- [StudioConfigForm](../src/components/studio/StudioConfigForm.tsx) - Main configuration form
- [SettingsSection](../src/components/studio/sections/SettingsSection.tsx) - Settings container
- [DimensionsForm](../src/components/studio/form/DimensionsForm.tsx) - Studio dimensions configuration
- [TracksForm](../src/components/studio/form/TracksForm.tsx) - Camera tracks list
- [TrackForm](../src/components/studio/form/TrackForm.tsx) - Individual camera track configuration

### Analytics
- [StudioAnalytics](../src/components/studio/analytics/StudioAnalytics.tsx) - Analytics dashboard
- [AnalyticsSummary](../src/components/studio/analytics/AnalyticsSummary.tsx) - Key metrics
- [DeviceStats](../src/components/studio/analytics/DeviceStats.tsx) - Device performance
- [EventTimeline](../src/components/studio/analytics/EventTimeline.tsx) - Events log
- [PerformanceMetrics](../src/components/studio/analytics/PerformanceMetrics.tsx) - Performance data
- [UsageChart](../src/components/studio/analytics/UsageChart.tsx) - Usage statistics

### Utilities
- [studioLighting](../src/components/studio/utils/studioLighting.ts) - Lighting scene setup

### State Management
- [useStudioState](../src/hooks/useStudioState.ts) - Main state hook
- [useStudioConfigForm](../src/components/studio/form/useStudioConfigForm.ts) - Form state management

## Type Definitions

- [Workspace Types](../src/components/studio/types/workspace.ts) - PTZ, studio dimensions
- [Component Types](../src/components/studio/types/componentTypes.ts) - Props interfaces
- [Analytics Types](../src/components/studio/types/analyticsTypes.ts) - Analytics data types

## Workflow

1. **Studio Configuration**
   - Set studio dimensions
   - Configure camera tracks
   - Adjust lighting settings

2. **Content Creation**
   - Record content using the Record tab
   - Stream live using the Stream tab
   - Control camera positions and angles

3. **Post-Production**
   - Edit content in the Edit tab
   - Export or publish finished content

4. **Analysis**
   - Review performance metrics
   - Analyze usage patterns
   - Monitor system resources

## Integration Points

The Studio module integrates with:
- Three.js for 3D rendering
- Audio/video capture APIs
- Content storage
- Analytics data collection

## Future Development

Planned features include:
- Additional lighting presets
- Virtual set templates
- Green screen integration
- Multi-camera synchronization
- AI-driven camera direction
