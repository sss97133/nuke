
import { mockStudioConfig } from '../utils/testUtils';

export const createMockConfiguration = () => {
  return {
    ...mockStudioConfig,
    id: `config-${Date.now()}`,
    name: `Studio ${Date.now()}`,
    workspace_dimensions: {
      width: 500,
      height: 300,
      length: 600
    }
  };
};

export const createMockPTZConfiguration = () => {
  return {
    ...mockStudioConfig,
    id: `ptz-config-${Date.now()}`,
    name: `PTZ Studio ${Date.now()}`,
    ptz_configurations: {
      planes: {
        walls: [
          {
            id: 'wall-1',
            name: 'North Wall',
            position: { x: 0, y: 150, z: 300 },
            dimensions: { width: 500, height: 300 },
            orientation: 'front'
          }
        ],
        ceiling: {
          position: { x: 0, y: 300, z: 0 },
          dimensions: { width: 500, length: 600 }
        }
      },
      tracks: [
        {
          id: 'track-1',
          name: 'Ceiling Track',
          start: { x: -200, y: 280, z: 0 },
          end: { x: 200, y: 280, z: 0 },
          speed: 50
        }
      ],
      roboticArms: []
    }
  };
};
