
import { vi } from 'vitest';
import { WorkspaceDimensions, PTZTrack } from '@/types/studio';

// Mock data for studio configuration tests
export const mockUseStudioConfig = () => {
  return {
    studioConfig: {
      name: "Test Studio",
      width: 1920,
      height: 1080,
      workspace_dimensions: {
        width: 20,
        height: 16,
        length: 30
      } as WorkspaceDimensions,
      ptz_configurations: {
        tracks: [{
          position: { x: 0, y: 8, z: 0 },
          length: 10,
          speed: 1,
          coneAngle: 45,
        }] as PTZTrack[],
        planes: { walls: [], ceiling: {} },
        roboticArms: []
      }
    },
    isLoading: false,
    error: null,
    saveStudioConfig: mockSaveStudioConfig
  };
};

export const mockSaveStudioConfig = vi.fn();
