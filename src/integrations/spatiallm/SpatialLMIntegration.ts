import { PTZTrack } from '@/components/studio/types/workspace';
import { WorkspaceDimensions } from '@/components/studio/types/workspace';
import { getConfig } from '@/config/spatiallm';
import { WorkspaceProcessor } from '@/services/spatiallm/WorkspaceProcessor';

interface SpatialAnalysis {
  coverageScore: number;
  blindSpots: Array<{
    position: { x: number; y: number; z: number };
    radius: number;
  }>;
  cameras: Array<{
    position: { x: number; y: number; z: number };
    fov: number;
    range: number;
    rotation: { x: number; y: number; z: number };
  }>;
}

export class SpatialLMIntegration {
  private config = getConfig();
  private processor: WorkspaceProcessor;

  constructor() {
    this.processor = new WorkspaceProcessor();
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing SpatialLM integration with config:', this.config);
      await this.processor.initialize();
      console.log('SpatialLM integration initialized successfully');
    } catch (error) {
      console.error('Failed to initialize SpatialLM:', error);
      throw error;
    }
  }

  async analyzeWorkspace(
    dimensions: WorkspaceDimensions,
    currentTracks: PTZTrack[]
  ): Promise<SpatialAnalysis> {
    try {
      const workspaceData = this.convertToSpatialLMFormat(dimensions, currentTracks);
      const analysis = await this.processor.analyzeWorkspace(workspaceData);
      return this.convertFromSpatialLMFormat(analysis);
    } catch (error) {
      console.error('Failed to analyze workspace:', error);
      throw error;
    }
  }

  async optimizeCameraPositions(
    dimensions: WorkspaceDimensions,
    currentTracks: PTZTrack[],
    targetCoverage: number = 0.95
  ): Promise<PTZTrack[]> {
    try {
      const workspaceData = this.convertToSpatialLMFormat(dimensions, currentTracks);
      const optimizedPositions = await this.processor.optimizePositions(workspaceData, targetCoverage);
      return this.convertFromSpatialLMFormat(optimizedPositions);
    } catch (error) {
      console.error('Failed to optimize camera positions:', error);
      throw error;
    }
  }

  private convertToSpatialLMFormat(
    dimensions: WorkspaceDimensions,
    tracks: PTZTrack[]
  ): any {
    return {
      dimensions: {
        length: dimensions.length,
        width: dimensions.width,
        height: dimensions.height
      },
      cameras: tracks.map(track => ({
        position: track.position,
        fov: track.coneAngle,
        range: track.length,
        rotation: track.rotation || { x: 0, y: 0, z: 0 }
      })),
      config: {
        confidenceThreshold: this.config.confidenceThreshold,
        maxObjects: this.config.maxObjects,
        minObjectSize: this.config.minObjectSize,
        maxObjectSize: this.config.maxObjectSize,
        pointCloudDensity: this.config.pointCloudDensity
      }
    };
  }

  private convertFromSpatialLMFormat(data: any): any {
    return {
      coverageScore: data.coverageScore,
      blindSpots: data.blindSpots,
      cameras: data.cameras
    };
  }
} 