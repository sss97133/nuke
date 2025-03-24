import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpatialLMIntegration } from '../SpatialLMIntegration';
import { PTZTrack } from '@/components/studio/types/workspace';
import { WorkspaceDimensions } from '@/components/studio/types/workspace';

describe('SpatialLMIntegration', () => {
  let integration: SpatialLMIntegration;
  let mockDimensions: WorkspaceDimensions;
  let mockTracks: PTZTrack[];

  beforeEach(() => {
    integration = new SpatialLMIntegration();
    mockDimensions = {
      length: 10,
      width: 10,
      height: 5
    };
    mockTracks = [
      {
        id: 'camera-1',
        name: 'Camera 1',
        position: { x: 0, y: 2, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        target: { x: 5, y: 2, z: 5 },
        speed: 1,
        zoom: 1,
        length: 10,
        coneAngle: 60
      }
    ];
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(integration.initialize()).resolves.not.toThrow();
    });
  });

  describe('analyzeWorkspace', () => {
    it('should analyze workspace and return coverage data', async () => {
      const result = await integration.analyzeWorkspace(mockDimensions, mockTracks);
      
      expect(result).toHaveProperty('coverageScore');
      expect(result).toHaveProperty('blindSpots');
      expect(result).toHaveProperty('cameras');
      
      expect(typeof result.coverageScore).toBe('number');
      expect(Array.isArray(result.blindSpots)).toBe(true);
      expect(Array.isArray(result.cameras)).toBe(true);
    });

    it('should handle empty tracks array', async () => {
      const result = await integration.analyzeWorkspace(mockDimensions, []);
      expect(result.cameras).toHaveLength(0);
    });
  });

  describe('optimizeCameraPositions', () => {
    it('should optimize camera positions', async () => {
      const result = await integration.optimizeCameraPositions(
        mockDimensions,
        mockTracks,
        0.95
      );
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(mockTracks.length);
      
      // Check that positions have been modified
      result.forEach((track, index) => {
        expect(track.position).not.toEqual(mockTracks[index].position);
      });
    });

    it('should maintain camera properties while optimizing positions', async () => {
      const result = await integration.optimizeCameraPositions(
        mockDimensions,
        mockTracks,
        0.95
      );
      
      result.forEach((track, index) => {
        expect(track.id).toBe(mockTracks[index].id);
        expect(track.name).toBe(mockTracks[index].name);
        expect(track.speed).toBe(mockTracks[index].speed);
        expect(track.zoom).toBe(mockTracks[index].zoom);
        expect(track.length).toBe(mockTracks[index].length);
        expect(track.coneAngle).toBe(mockTracks[index].coneAngle);
      });
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors', async () => {
      // Mock console.error to prevent test output noise
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Force an error by setting an invalid config
      process.env.SPATIALLM_MODEL_PATH = '';
      
      await expect(integration.initialize()).rejects.toThrow();
      
      consoleSpy.mockRestore();
    });

    it('should handle analysis errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Force an error by passing invalid dimensions
      const invalidDimensions = { length: -1, width: -1, height: -1 } as WorkspaceDimensions;
      
      await expect(integration.analyzeWorkspace(invalidDimensions, mockTracks))
        .rejects.toThrow();
      
      consoleSpy.mockRestore();
    });
  });
}); 