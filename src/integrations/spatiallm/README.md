# SpatialLM Integration

This integration provides workspace analysis and camera optimization capabilities using the SpatialLM model.

## Features

- Real-time workspace coverage analysis
- Blind spot detection
- Camera position optimization
- 3D point cloud generation
- Object detection and tracking

## Prerequisites

- Python 3.11 or higher
- CUDA 12.4 (for GPU acceleration)
- Node.js 18 or higher
- npm or yarn

## Installation

1. Clone the repository and install dependencies:
```bash
npm install
```

2. Set up the Python environment and install SpatialLM:
```bash
./scripts/setup-spatiallm.sh
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your specific configuration
```

## Configuration

The following environment variables can be configured:

```env
SPATIALLM_MODEL_PATH=/models/spatiallm/model.pt
SPATIALLM_DEVICE=cuda
SPATIALLM_BATCH_SIZE=32
SPATIALLM_CONFIDENCE_THRESHOLD=0.5
SPATIALLM_MAX_OBJECTS=100
SPATIALLM_MIN_OBJECT_SIZE=0.1
SPATIALLM_MAX_OBJECT_SIZE=10.0
SPATIALLM_POINT_CLOUD_DENSITY=0.1
SPATIALLM_PROCESSING_TIMEOUT=30000
SPATIALLM_PYTHON_PATH=python
```

## Usage

### Basic Integration

```typescript
import { SpatialLMIntegration } from '@/integrations/spatiallm/SpatialLMIntegration';

const integration = new SpatialLMIntegration();

// Initialize the integration
await integration.initialize();

// Analyze workspace
const analysis = await integration.analyzeWorkspace(dimensions, tracks);

// Optimize camera positions
const optimizedTracks = await integration.optimizeCameraPositions(
  dimensions,
  tracks,
  0.95 // target coverage
);
```

### React Component Usage

```typescript
import { useSpatialLM } from '@/hooks/useSpatialLM';

function WorkspaceComponent() {
  const { coverageScore, blindSpots, optimizePositions } = useSpatialLM();

  // Use the hook in your component
  return (
    <div>
      <div>Coverage Score: {coverageScore}</div>
      {/* Render blind spots and camera positions */}
    </div>
  );
}
```

## Testing

Run the integration tests:

```bash
# Run all SpatialLM tests
npm run test:spatiallm

# Run integration tests
npm run test:spatiallm:integration

# Run tests in watch mode
npm run test:spatiallm:watch
npm run test:spatiallm:integration:watch
```

## Development

### Project Structure

```
src/
  integrations/
    spatiallm/
      README.md
      SpatialLMIntegration.ts
      __tests__/
        SpatialLMIntegration.test.ts
  services/
    spatiallm/
      WorkspaceProcessor.ts
      __tests__/
        WorkspaceProcessor.test.ts
  config/
    spatiallm.ts
```

### Adding New Features

1. Update the configuration in `src/config/spatiallm.ts`
2. Add new methods to `SpatialLMIntegration` class
3. Write tests in `__tests__/SpatialLMIntegration.test.ts`
4. Update documentation

## Troubleshooting

### Common Issues

1. **Model Loading Failed**
   - Check if the model file exists at the configured path
   - Verify CUDA installation and compatibility
   - Check Python environment setup

2. **Performance Issues**
   - Adjust batch size in configuration
   - Check GPU memory usage
   - Optimize point cloud density

3. **Integration Errors**
   - Verify environment variables
   - Check Python path configuration
   - Review error logs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Submit a pull request

## License

This integration is part of the main project and follows its licensing terms. 