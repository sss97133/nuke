# SpatialLM Integration

## Overview
SpatialLM is an advanced spatial understanding model that enables real-time workspace analysis and optimization for PTZ camera systems. This integration provides automated workspace mapping, object detection, and camera position optimization.

## Features
- Real-time workspace capture and analysis
- 3D point cloud generation from 2D images
- Object detection and dimensioning
- Camera position optimization
- Coverage analysis and blind spot detection
- Integration with PTZ camera systems

## Prerequisites
- CUDA-capable GPU (recommended)
- Python 3.11 or higher
- CUDA 12.4 toolkit
- Conda environment manager
- Node.js 18 or higher

## Installation

### 1. Environment Setup
```bash
# Run the setup script
./scripts/setup-spatiallm.sh

# Activate the conda environment
conda activate spatiallm
```

### 2. Model Weights
The SpatialLM model weights are required for operation. These will be automatically downloaded during setup, or you can manually download them:

```bash
# Create models directory
mkdir -p public/models/spatiallm

# Download model weights (replace URL with actual model URL)
curl -L -o public/models/spatiallm/model.pt https://example.com/spatiallm-model.pt
```

## Usage

### 1. Workspace Capture
```typescript
import { WorkspaceCapture } from '@/components/studio/capture/WorkspaceCapture';

// In your component
<WorkspaceCapture
  onCaptureComplete={(data) => {
    // Handle captured workspace data
    console.log('Workspace dimensions:', data.dimensions);
    console.log('Detected objects:', data.objects);
  }}
/>
```

### 2. Analysis Integration
```typescript
import { useSpatialLM } from '@/hooks/useSpatialLM';

// In your component
const {
  isInitialized,
  isAnalyzing,
  isOptimizing,
  error,
  analyzeWorkspace,
  optimizePositions
} = useSpatialLM({
  dimensions: workspaceDimensions,
  ptzTracks: cameraTracks,
  onOptimizedPositions: (positions) => {
    // Handle optimized camera positions
  },
  onAnalysisUpdate: (analysis) => {
    // Handle analysis updates
  }
});
```

## API Reference

### WorkspaceCapture Component
Props:
- `onCaptureComplete`: Callback function that receives the processed workspace data
  ```typescript
  {
    pointCloud: Float32Array;
    dimensions: {
      length: number;
      width: number;
      height: number;
    };
    objects: Array<{
      type: string;
      position: { x: number; y: number; z: number };
      dimensions: { length: number; width: number; height: number };
    }>;
  }
  ```

### useSpatialLM Hook
Parameters:
- `dimensions`: Workspace dimensions
- `ptzTracks`: Array of PTZ camera tracks
- `onOptimizedPositions`: Callback for optimized camera positions
- `onAnalysisUpdate`: Callback for analysis updates

Returns:
- `isInitialized`: Boolean indicating if SpatialLM is ready
- `isAnalyzing`: Boolean indicating if analysis is in progress
- `isOptimizing`: Boolean indicating if optimization is in progress
- `error`: Any error that occurred
- `analyzeWorkspace`: Function to trigger workspace analysis
- `optimizePositions`: Function to optimize camera positions

## Best Practices

### Workspace Capture
1. Ensure good lighting conditions
2. Capture from multiple angles
3. Move the camera slowly for better quality
4. Cover all corners and potential blind spots
5. Keep the camera steady during capture

### Camera Optimization
1. Set realistic coverage targets (default: 95%)
2. Consider physical constraints when applying optimizations
3. Review blind spot reports before finalizing positions
4. Test camera movements in the optimized positions

## Troubleshooting

### Common Issues
1. **Model Loading Failures**
   - Verify CUDA installation
   - Check model weights are present
   - Ensure sufficient GPU memory

2. **Capture Issues**
   - Check camera permissions
   - Verify lighting conditions
   - Ensure stable camera movement

3. **Processing Errors**
   - Check Python environment
   - Verify SpatialLM installation
   - Review error logs

## Development

### Adding New Features
1. Extend the `SpatialLMIntegration` class
2. Add new methods to the `useSpatialLM` hook
3. Create new visualization components
4. Update documentation

### Testing
```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run end-to-end tests
npm run test:e2e
```

## Contributing
See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines on contributing to the SpatialLM integration. 